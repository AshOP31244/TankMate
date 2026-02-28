from django.http import JsonResponse , HttpResponse
from django.shortcuts import render, redirect
from django.db.models import Q
from django.db.models.functions import Cast
from django.db.models import FloatField
import csv
from django.contrib import messages
from .models import Tank
from django.contrib.auth import authenticate, login, logout
from django.views.decorators.http import require_POST

def custom_login(request):
    if request.user.is_authenticated:
        return redirect('admin_dashboard')

    if request.method == "POST":
        username = request.POST.get('username')
        password = request.POST.get('password')

        user = authenticate(request, username=username, password=password)

        if user is not None:
            if user.is_staff:
                login(request, user)
                return redirect('admin_dashboard')
            else:
                messages.error(request, "You do not have admin access.")
        else:
            messages.error(request, "Invalid username or password.")

    return render(request, 'calculator/admin/login.html')

@require_POST
def custom_logout(request):
    logout(request)
    return redirect('custom_login')


def home(request):
    """Main page with 5 tank category cards"""
    return render(request, "calculator/home.html")


def tank_search(request):
    
    # Get search parameters
    category = request.GET.get("category")  # Optional: None = universal search
    capacity_value = request.GET.get("capacity")
    model_value = request.GET.get("model")
    diameter_value = request.GET.get("diameter")
    height_value = request.GET.get("height")
    
    min_price = request.GET.get("min_price")
    max_price = request.GET.get("max_price")
       
    sort_by = request.GET.get("sort_by", "capacity")  
    
    results = []
    search_info = {
        "category": category or "all",
        "search_type": None,
    }
    
    # Base query: filter by category if specified
    if category:
        base_query = Tank.objects.filter(category=category.upper(), is_active=True)
    else:
        # Universal search: all categories (only active)
        base_query = Tank.objects.filter(is_active=True)
    
    # PRIORITY 1: Model Search (Most Specific)
    if model_value and model_value.strip():
        tanks = base_query.filter(model__icontains=model_value.strip())
        
        for tank in tanks:
            results.append(format_tank_result(tank))
        
        search_info["search_type"] = "model"
        search_info["query"] = model_value.strip()
    
    # PRIORITY 2: Dimensions Search
    elif diameter_value and height_value:
        try:
            target_diameter = float(diameter_value)
            target_height = float(height_value)
            
            # Find tanks within tolerance
            tolerance = 0.9
            tanks = base_query.filter(
                diameter__gte=target_diameter - tolerance,
                diameter__lte=target_diameter + tolerance,
                height__gte=target_height - tolerance,
                height__lte=target_height + tolerance
            )
            
            # Calculate match scores
            dimension_results = []
            for tank in tanks:
                diameter_diff = abs(tank.diameter - target_diameter)
                height_diff = abs(tank.height - target_height)
                score = diameter_diff + height_diff
                
                dimension_results.append({
                    "tank": tank,
                    "score": score,
                    "diameter_diff": round(diameter_diff, 2),
                    "height_diff": round(height_diff, 2),
                })
            
            # Sort by best match
            dimension_results.sort(key=lambda x: x["score"])
            dimension_results = dimension_results[:20]
            
            for item in dimension_results:
                result = format_tank_result(item["tank"])
                result["match_type"] = "approximate"
                result["diameter_diff"] = item["diameter_diff"]
                result["height_diff"] = item["height_diff"]
                results.append(result)
            
            search_info["search_type"] = "dimensions"
            search_info["diameter"] = target_diameter
            search_info["height"] = target_height
            
        except (ValueError, TypeError):
            return JsonResponse({"error": "Invalid dimension values"}, status=400)
    
    # PRIORITY 3: Capacity Search
    elif capacity_value:
        try:
            target_capacity = float(capacity_value)
            
            # Find tanks within range
            tolerance = 0.15  # 15% tolerance
            min_capacity = target_capacity * (1 - tolerance)
            max_capacity = target_capacity * (1 + tolerance)
            
            capacity_results = []
            tanks = base_query.filter(
                net_capacity__gte=min_capacity,
                net_capacity__lte=max_capacity
            )
            
            for tank in tanks:
                diff = abs(tank.net_capacity - target_capacity)
                capacity_results.append({
                    "tank": tank,
                    "diff": diff
                })
            
            # Sort by closeness
            capacity_results.sort(key=lambda x: x["diff"])
            capacity_results = capacity_results[:20]
            
            for item in capacity_results:
                result = format_tank_result(item["tank"])
                result["match_difference"] = round(item["diff"], 2)
                
                # Label match quality
                if item["diff"] < 1:
                    result["match_label"] = "Exact Match"
                elif item["tank"].net_capacity > target_capacity:
                    result["match_label"] = "Higher Capacity Option"
                else:
                    result["match_label"] = "Closest Match"
                
                results.append(result)
            
            search_info["search_type"] = "capacity"
            search_info["capacity_kl"] = target_capacity
            
        except (ValueError, TypeError):
            return JsonResponse({"error": "Invalid capacity value"}, status=400)
    
    # PRIORITY 4: Diameter Only
    elif diameter_value:
        try:
            target_diameter = float(diameter_value)
            tolerance = 0.9
            
            tanks = base_query.filter(
                diameter__gte=target_diameter - tolerance,
                diameter__lte=target_diameter + tolerance
            ).order_by('diameter', 'net_capacity')[:20]
            
            for tank in tanks:
                results.append(format_tank_result(tank))
            
            search_info["search_type"] = "diameter"
            search_info["diameter"] = target_diameter
            
        except (ValueError, TypeError):
            return JsonResponse({"error": "Invalid diameter value"}, status=400)
    
    # PRIORITY 5: Height Only
    elif height_value:
        try:
            target_height = float(height_value)
            tolerance = 0.9
            
            tanks = base_query.filter(
                height__gte=target_height - tolerance,
                height__lte=target_height + tolerance
            ).order_by('height', 'net_capacity')[:20]
            
            for tank in tanks:
                results.append(format_tank_result(tank))
            
            search_info["search_type"] = "height"
            search_info["height"] = target_height
            
        except (ValueError, TypeError):
            return JsonResponse({"error": "Invalid height value"}, status=400)
    
    # PRIORITY 6: Show All (with optional price filter)
    else:
        tanks = base_query.order_by('net_capacity')[:50]  # Limit to 50 for performance
        
        for tank in tanks:
            results.append(format_tank_result(tank))
        
        search_info["search_type"] = "browse"
    
    # ==================== PRICE FILTERING ====================
    if min_price or max_price:
        try:
            filtered_results = []
            
            for result in results:
                price = float(result["ideal_price"])
                
                # Apply min price filter
                if min_price and price < float(min_price):
                    continue
                
                # Apply max price filter
                if max_price and price > float(max_price):
                    continue
                
                filtered_results.append(result)
            
            results = filtered_results
            search_info["price_filtered"] = True
            if min_price:
                search_info["min_price"] = float(min_price)
            if max_price:
                search_info["max_price"] = float(max_price)
        
        except (ValueError, TypeError):
            return JsonResponse({"error": "Invalid price values"}, status=400)
    
    # ==================== SORTING ====================
    if sort_by == "price_asc":
        results.sort(key=lambda x: float(x["ideal_price"]))
        search_info["sorted_by"] = "price_low_to_high"
    
    elif sort_by == "price_desc":
        results.sort(key=lambda x: float(x["ideal_price"]), reverse=True)
        search_info["sorted_by"] = "price_high_to_low"
    
    elif sort_by == "capacity":
        results.sort(key=lambda x: x["net_capacity"])
        search_info["sorted_by"] = "capacity_low_to_high"
    
    # Return results
    return JsonResponse({
        "results": results,
        "search_info": search_info,
        "count": len(results)
    })


def format_tank_result(tank):
    return {
        "category": tank.category,
        "category_name": tank.get_category_display_name(),
        "model": tank.model,
        "diameter": tank.diameter,
        "height": tank.height,
        
        # NEW: Dual capacity fields
        "net_capacity": tank.net_capacity,
        "gross_capacity": tank.gross_capacity,
        "capacity_display": tank.get_capacity_display(),
        "gross_capacity_display": tank.get_gross_capacity_display(),
        
        # NEW: Pricing fields
        "ideal_price": float(tank.ideal_price),
        "nrp": float(tank.nrp),
        "price_display": tank.get_price_display(),
        "nrp_display": tank.get_nrp_display(),
        
        # Utility
        "dimensions_display": tank.get_dimensions_display(),
        "price_per_kl": round(tank.price_per_kl, 2) if tank.price_per_kl else 0,
    }


def get_models_for_type(request):
    category = request.GET.get("category")  # Optional
    query = request.GET.get("q", "").strip()
    if len(query) < 2:
        return JsonResponse({
            "models": [],
            "count": 0
        })
    
    # Base query
    if category:
        tanks = Tank.objects.filter(category=category.upper())
    else:
        # Universal search: all categories
        tanks = Tank.objects.all()
    
    # Apply fuzzy search if query provided
    if query:
        tanks = tanks.filter(Q(model__icontains=query))
    
    # Get unique models and sort
    tanks = tanks.order_by('diameter', 'height')[:50]
    
    # Format results with metadata
    models = []
    for tank in tanks:
        models.append({
            "model": tank.model,
            "category": tank.category,
            "category_name": tank.get_category_display_name(),
            "diameter": tank.diameter,
            "height": tank.height,
            "net_capacity": tank.net_capacity,
            "price": float(tank.ideal_price),
        })
    
    return JsonResponse({
        "models": models,
        "count": len(models)
    })


def get_category_stats(request):    
    stats = {}
    
    for category_code, category_name in Tank.CATEGORY_CHOICES:
        tanks = Tank.objects.filter(category=category_code)
        count = tanks.count()
        
        if count > 0:
            stats[category_code] = {
                "name": category_name,
                "count": count,
                "min_capacity": tanks.order_by('net_capacity').first().net_capacity,
                "max_capacity": tanks.order_by('-net_capacity').first().net_capacity,
                "min_price": float(tanks.order_by('ideal_price').first().ideal_price),
                "max_price": float(tanks.order_by('-ideal_price').first().ideal_price),
            }
    
    # Universal stats (all categories)
    all_tanks = Tank.objects.all()
    stats["ALL"] = {
        "name": "Universal Search",
        "count": all_tanks.count(),
        "min_capacity": all_tanks.order_by('net_capacity').first().net_capacity if all_tanks.exists() else 0,
        "max_capacity": all_tanks.order_by('-net_capacity').first().net_capacity if all_tanks.exists() else 0,
        "min_price": float(all_tanks.order_by('ideal_price').first().ideal_price) if all_tanks.exists() else 0,
        "max_price": float(all_tanks.order_by('-ideal_price').first().ideal_price) if all_tanks.exists() else 0,
    }
    
    return JsonResponse({"stats": stats})

def download_tank_template(request):
    response = HttpResponse(content_type='text/csv')
    response['Content-Disposition'] = 'attachment; filename="tank_template.csv"'

    writer = csv.writer(response)

    # Header row (exact format you want)
    writer.writerow([
        'id',
        'tank_model',
        'diameter',
        'height',
        'net_capacity',
        'gross_capacity',
        'ideal_price',
        'nrp'
    ])

    return response