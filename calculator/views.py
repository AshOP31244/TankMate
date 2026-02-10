from django.http import JsonResponse
from django.shortcuts import render
from django.db.models import F, Q
from django.db.models.functions import Abs
import math

from .models import Tank, TankCapacity


def home(request):
    return render(request, "calculator/home.html")


def tank_search(request):
    tank_type = request.GET.get("tank_type")
    capacity_value = request.GET.get("capacity")
    model_value = request.GET.get("model")
    diameter_value = request.GET.get("diameter")
    height_value = request.GET.get("height")

    # Validate tank type is selected
    if not tank_type:
        return JsonResponse({"error": "Please select a tank type first"}, status=400)

    results = []
    search_info = {}

    # Base query filtered by tank type
    base_tank_query = Tank.objects.filter(tank_type=tank_type)

    # PRIORITY 1: Model Search (Most Specific - Exact Match Only)
    if model_value and model_value.strip():
        tanks = base_tank_query.filter(model__icontains=model_value.strip())
        for tank in tanks:
            for cap in tank.capacities.all():
                results.append(format_tank_result(tank, cap))
        
        search_info = {
            "search_type": "model",
            "query": model_value.strip()
        }

    # PRIORITY 2: Dimensions Search with NEAREST-MATCH LOGIC
    elif diameter_value and height_value:
        try:
            target_diameter = round(float(diameter_value), 1)
            target_height = round(float(height_value), 1)
            
            # Calculate volume
            calculated_volume_kl = TankCapacity.calculate_volume(target_diameter, target_height)
            
            # Get all unique diameters for this tank type
            available_diameters = list(base_tank_query.values_list('diameter', flat=True).distinct())
            
            # Find nearest matching diameters (within 15% tolerance)
            matching_diameters = TankCapacity.find_nearest_diameter(
                target_diameter, 
                available_diameters, 
                tolerance_percent=0.15
            )
            
            if not matching_diameters:
                matching_diameters = TankCapacity.find_nearest_diameter(
                    target_diameter, 
                    available_diameters, 
                    tolerance_percent=0.25
                )
            
            dimension_results = []
            
            # Get tanks with matching diameters
            matching_tanks = base_tank_query.filter(diameter__in=matching_diameters)
            
            for tank in matching_tanks:
                # Get all heights for this tank
                available_heights = list(tank.capacities.values_list('height', flat=True))
                
                # Find nearest height (within 0.3m tolerance)
                nearest_height = TankCapacity.find_nearest_height(
                    target_height, 
                    available_heights, 
                    tolerance=0.5
                )
                
                if nearest_height is not None:
                    # Get capacity for this exact height
                    cap = tank.capacities.filter(height=nearest_height).first()
                    if cap:
                        tank_kl = cap.get_capacity_in_kl()
                        
                        diameter_diff = abs(tank.diameter - target_diameter)
                        height_diff = abs(cap.height - target_height)
                        capacity_diff = abs(tank_kl - calculated_volume_kl)
                        
                        # Weighted scoring
                        score = capacity_diff + (diameter_diff * 2) + (height_diff * 2)
                        
                        dimension_results.append({
                            "tank": tank,
                            "capacity_obj": cap,
                            "score": score,
                            "diameter_diff": diameter_diff,
                            "height_diff": height_diff,
                        })
                else:
                    # If no exact height match, get closest heights
                    for cap in tank.capacities.all():
                        tank_kl = cap.get_capacity_in_kl()
                        
                        diameter_diff = abs(tank.diameter - target_diameter)
                        height_diff = abs(cap.height - target_height)
                        capacity_diff = abs(tank_kl - calculated_volume_kl)
                        
                        score = capacity_diff + (diameter_diff * 2) + (height_diff * 2)
                        
                        dimension_results.append({
                            "tank": tank,
                            "capacity_obj": cap,
                            "score": score,
                            "diameter_diff": diameter_diff,
                            "height_diff": height_diff,
                        })
            
            # Sort by score and limit
            dimension_results.sort(key=lambda x: x["score"])
            dimension_results = dimension_results[:15]
            
            for item in dimension_results:
                result = format_tank_result(item["tank"], item["capacity_obj"])
                result["match_type"] = "approximate"
                result["diameter_diff"] = round(item["diameter_diff"], 2)
                result["height_diff"] = round(item["height_diff"], 2)
                results.append(result)
            
            search_info = {
                "search_type": "dimensions",
                "calculated_volume": round(calculated_volume_kl, 2),
                "diameter": target_diameter,
                "height": target_height
            }
                
        except (ValueError, TypeError):
            return JsonResponse({"error": "Invalid dimension values"}, status=400)

    # PRIORITY 3: Capacity Search with Smart Filtering
    elif capacity_value:
        try:
            capacity_kl = float(capacity_value)
            
            # Apply range-based filtering for RCT and SST only
            if tank_type in ["RCT", "SST"]:
                lower_bound = capacity_kl - 4  
                upper_bound = capacity_kl + 40  
                
                capacity_results = []
                
                for tank in base_tank_query:
                    for cap in tank.capacities.all():
                        tank_kl = cap.get_capacity_in_kl()
                        
                        if tank_kl < lower_bound or tank_kl > upper_bound:
                            continue
                        
                        diff = abs(tank_kl - capacity_kl)
                        
                        capacity_results.append({
                            "tank": tank,
                            "capacity_obj": cap,
                            "capacity_kl": tank_kl,
                            "diff": diff
                        })
                
                # Sort by closeness
                capacity_results.sort(key=lambda x: x["diff"])
                capacity_results = capacity_results[:15]
                
                for item in capacity_results:
                    result = format_tank_result(item["tank"], item["capacity_obj"])
                    result["match_difference"] = round(item["diff"], 2)
                    
                    # Label match quality
                    if item["diff"] < 2:
                        result["match_label"] = "Exact Match"
                    elif item["capacity_kl"] > capacity_kl:
                        result["match_label"] = "Higher Capacity Option"
                    else:
                        result["match_label"] = "Closest Match"
                    
                    results.append(result)
            
            else:
                # FM tanks: use broader search
                capacity_results = []
                
                for tank in base_tank_query:
                    for cap in tank.capacities.all():
                        tank_kl = cap.get_capacity_in_kl()
                        diff = abs(tank_kl - capacity_kl)
                        
                        capacity_results.append({
                            "tank": tank,
                            "capacity_obj": cap,
                            "capacity_kl": tank_kl,
                            "diff": diff
                        })
                
                capacity_results.sort(key=lambda x: x["diff"])
                capacity_results = capacity_results[:15]
                
                for item in capacity_results:
                    result = format_tank_result(item["tank"], item["capacity_obj"])
                    result["match_difference"] = round(item["diff"], 2)
                    results.append(result)
            
            search_info = {
                "search_type": "capacity",
                "capacity_kl": capacity_kl,
                "lower_bound": lower_bound if tank_type in ["RCT", "SST"] else None,
                "upper_bound": upper_bound if tank_type in ["RCT", "SST"] else None,
            }
                
        except (ValueError, TypeError):
            return JsonResponse({"error": "Invalid capacity value"}, status=400)

    # PRIORITY 4: Diameter Only with NEAREST-MATCH
    elif diameter_value:
        try:
            target_diameter = float(diameter_value)
            
            # Get all available diameters
            available_diameters = list(base_tank_query.values_list('diameter', flat=True).distinct())
            
            # Find nearest matching diameters
            matching_diameters = TankCapacity.find_nearest_diameter(
                target_diameter, 
                available_diameters, 
                tolerance_percent=0.20
            )
            
            if not matching_diameters:
                # If no matches, get closest ones
                matching_diameters = sorted(available_diameters, key=lambda d: abs(d - target_diameter))[:5]
            
            tanks = base_tank_query.filter(diameter__in=matching_diameters).order_by('diameter')[:20]
            
            for tank in tanks:
                first_cap = tank.capacities.first()
                if first_cap:
                    results.append(format_tank_result(tank, first_cap))
            
            search_info = {
                "search_type": "diameter",
                "diameter": target_diameter
            }
        except (ValueError, TypeError):
            return JsonResponse({"error": "Invalid diameter value"}, status=400)

    # PRIORITY 5: Height Only with NEAREST-MATCH
    elif height_value:
        try:
            target_height = float(height_value)
            
            # Get all available heights for this tank type
            all_capacities = TankCapacity.objects.filter(tank__in=base_tank_query)
            available_heights = list(all_capacities.values_list('height', flat=True).distinct())
            
            # Find nearest height
            nearest_height = TankCapacity.find_nearest_height(
                target_height, 
                available_heights, 
                tolerance=0.5
            )
            
            if nearest_height is not None:
                # Get exact matches for this height
                caps = all_capacities.filter(height=nearest_height).select_related('tank')[:20]
            else:
                # Get closest heights (within ±0.5m)
                caps = all_capacities.filter(
                    height__gte=target_height - 0.5,
                    height__lte=target_height + 0.5
                ).select_related('tank').order_by('height')[:20]
            
            for cap in caps:
                results.append(format_tank_result(cap.tank, cap))
            
            search_info = {
                "search_type": "height",
                "height": target_height
            }
        except (ValueError, TypeError):
            return JsonResponse({"error": "Invalid height value"}, status=400)

    else:
        return JsonResponse({"error": "Please enter at least one search parameter"}, status=400)

    return JsonResponse({
        "results": results,
        "search_info": search_info,
        "count": len(results)
    })


def format_tank_result(tank, capacity_obj):
    """Format tank and capacity into result dictionary with sales-friendly model name"""
    return {
        "tank_type": tank.tank_type,
        "tank_type_name": tank.get_tank_type_display(),
        "model": capacity_obj.get_display_model_name(),  # Sales-friendly name with height
        "base_model": tank.model,  # Original model name
        "diameter": tank.diameter,
        "height": capacity_obj.height,
        "capacity": capacity_obj.capacity,
        "capacity_kl": capacity_obj.get_capacity_in_kl(),
        "capacity_display": capacity_obj.get_capacity_display(),
        "capacity_kl_display": capacity_obj.get_capacity_kl_display(),
        "capacity_unit": tank.get_capacity_unit(),
    }


def get_models_for_type(request):
    """
    Enhanced autocomplete endpoint with fuzzy matching
    Returns filtered models based on search query
    """
    tank_type = request.GET.get("tank_type")
    query = request.GET.get("q", "").strip()
    
    if not tank_type:
        return JsonResponse({"models": []})
    
    # Base query
    tanks = Tank.objects.filter(tank_type=tank_type)
    
    # Apply fuzzy search if query provided
    if query:
        # Case-insensitive search on model name
        tanks = tanks.filter(Q(model__icontains=query))
    
    # Get unique models and sort
    tanks = tanks.order_by('model').distinct()
    
    # Format results with metadata
    models = []
    for tank in tanks:
        capacity_count = tank.capacities.count()
        
        models.append({
            "model": tank.model,
            "diameter": tank.diameter,
            "capacity_count": capacity_count,
            "tank_type": tank.tank_type,
        })
    
    return JsonResponse({
        "models": models,
        "count": len(models)
    })