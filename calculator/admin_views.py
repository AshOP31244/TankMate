from django.shortcuts import render, redirect
from django.contrib.admin.views.decorators import staff_member_required
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse, HttpResponse
from django.db import transaction
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_exempt
from django.core.paginator import Paginator
from .models import Tank
import csv
import io
from decimal import Decimal, InvalidOperation
from datetime import datetime


@login_required
def admin_dashboard(request):
    """Main admin dashboard with statistics"""
    context = {
        'total_tanks': Tank.objects.count(),
        'active_tanks': Tank.objects.filter(is_active=True).count(),
        'inactive_tanks': Tank.objects.filter(is_active=False).count(),
        'last_updated': Tank.objects.order_by('-updated_at').first(),
        'categories': {}
    }
    
    # Category breakdown
    for category_code, category_name in Tank.CATEGORY_CHOICES:
        context['categories'][category_code] = {
            'name': category_name,
            'count': Tank.objects.filter(category=category_code).count(),
            'active': Tank.objects.filter(category=category_code, is_active=True).count()
        }
    
    return render(request, 'calculator/admin/dashboard.html', context)


@login_required
def admin_tank_list(request):
    """Tank list with search, filter, and pagination"""
    tanks = Tank.objects.all().order_by('-updated_at')
    
    # Search
    search = request.GET.get('search', '').strip()
    if search:
        tanks = tanks.filter(model__icontains=search)
    
    # Filter by category
    category = request.GET.get('category', '').strip()
    if category:
        tanks = tanks.filter(category=category)
    
    # Filter by status
    status = request.GET.get('status', '').strip()
    if status == 'active':
        tanks = tanks.filter(is_active=True)
    elif status == 'inactive':
        tanks = tanks.filter(is_active=False)
    
    # Pagination
    paginator = Paginator(tanks, 25)
    page = request.GET.get('page', 1)
    tanks_page = paginator.get_page(page)
    
    return render(request, 'calculator/admin/tank_list.html', {
        'tanks': tanks_page,
        'categories': Tank.CATEGORY_CHOICES,
        'current_search': search,
        'current_category': category,
        'current_status': status
    })


@login_required
@require_POST
def admin_tank_update(request):
    """Update single tank via AJAX"""
    try:
        tank_id = request.POST.get('tank_id')
        field = request.POST.get('field')
        value = request.POST.get('value')
        
        tank = Tank.objects.get(id=tank_id)
        
        # Validate and update field
        if field == 'ideal_price' or field == 'nrp':
            setattr(tank, field, Decimal(value))
        elif field == 'net_capacity' or field == 'gross_capacity' or field == 'diameter' or field == 'height':
            setattr(tank, field, float(value))
        elif field == 'is_active':
            setattr(tank, field, value == 'true')
        else:
            return JsonResponse({'success': False, 'error': 'Invalid field'}, status=400)
        
        tank.save()
        
        return JsonResponse({
            'success': True,
            'message': f'{field} updated successfully',
            'new_value': str(getattr(tank, field))
        })
        
    except Tank.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Tank not found'}, status=404)
    except (ValueError, InvalidOperation) as e:
        return JsonResponse({'success': False, 'error': f'Invalid value: {str(e)}'}, status=400)
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@login_required
@require_POST
def admin_tank_toggle(request):
    """Toggle tank active status"""
    try:
        tank_id = request.POST.get('tank_id')
        tank = Tank.objects.get(id=tank_id)
        tank.is_active = not tank.is_active
        tank.save()
        
        return JsonResponse({
            'success': True,
            'is_active': tank.is_active,
            'message': f"Tank {'activated' if tank.is_active else 'deactivated'}"
        })
    except Tank.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Tank not found'}, status=404)
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@login_required
def admin_csv_upload(request):
    """CSV upload page"""
    return render(request, 'calculator/admin/csv_upload.html')


@login_required
@require_POST
def admin_csv_preview(request):
    """Preview CSV changes before applying"""
    try:
        csv_file = request.FILES.get('csv_file')
        
        if not csv_file:
            return JsonResponse({'success': False, 'error': 'No file uploaded'}, status=400)
        
        if not csv_file.name.endswith('.csv'):
            return JsonResponse({'success': False, 'error': 'File must be CSV'}, status=400)
        
        # Read CSV
        decoded_file = csv_file.read().decode('utf-8')
        io_string = io.StringIO(decoded_file)
        reader = csv.DictReader(io_string)
        
        changes = []
        errors = []
        
        for row_num, row in enumerate(reader, start=2):
            try:
                model = row.get('tank_model', '').strip()
                
                if not model:
                    errors.append(f"Row {row_num}: Missing tank_model")
                    continue
                
                # Check if tank exists
                existing_tank = Tank.objects.filter(model=model).first()
                
                change_data = {
                    'row': row_num,
                    'model': model,
                    'action': 'update' if existing_tank else 'create',
                    'old_data': {},
                    'new_data': {}
                }
                
                # Parse new data
                try:
                    new_data = {
                        'diameter': float(row.get('diameter', 0)),
                        'height': float(row.get('height', 0)),
                        'net_capacity': float(row.get('net_capacity', 0)),
                        'gross_capacity': float(row.get('gross_capacity', 0)),
                        'ideal_price': float(row.get('ideal_price', 0)),
                        'nrp': float(row.get('nrp', 0)),
                    }
                    change_data['new_data'] = new_data
                except (ValueError, KeyError) as e:
                    errors.append(f"Row {row_num}: Invalid data - {str(e)}")
                    continue
                
                # If updating, show old values
                if existing_tank:
                    change_data['old_data'] = {
                        'diameter': float(existing_tank.diameter),
                        'height': float(existing_tank.height),
                        'net_capacity': float(existing_tank.net_capacity),
                        'gross_capacity': float(existing_tank.gross_capacity),
                        'ideal_price': float(existing_tank.ideal_price),
                        'nrp': float(existing_tank.nrp),
                    }
                
                changes.append(change_data)
                
            except Exception as e:
                errors.append(f"Row {row_num}: {str(e)}")
        
        # Store changes in session for confirmation
        request.session['csv_changes'] = changes
        
        return JsonResponse({
            'success': True,
            'changes': changes,
            'errors': errors,
            'summary': {
                'to_create': len([c for c in changes if c['action'] == 'create']),
                'to_update': len([c for c in changes if c['action'] == 'update']),
                'errors': len(errors)
            }
        })
        
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@login_required
@require_POST
def admin_csv_confirm(request):
    """Apply confirmed CSV changes"""
    try:
        changes = request.session.get('csv_changes', [])
        
        if not changes:
            return JsonResponse({'success': False, 'error': 'No changes to apply'}, status=400)
        
        created_count = 0
        updated_count = 0
        errors = []
        
        with transaction.atomic():
            for change in changes:
                try:
                    model = change['model']
                    new_data = change['new_data']
                    
                    # Extract category
                    category = Tank.extract_category_from_model(model)
                    if not category:
                        errors.append(f"{model}: Could not determine category")
                        continue
                    
                    # Create or update
                    tank, created = Tank.objects.update_or_create(
                        model=model,
                        defaults={
                            'category': category,
                            'diameter': new_data['diameter'],
                            'height': new_data['height'],
                            'net_capacity': new_data['net_capacity'],
                            'gross_capacity': new_data['gross_capacity'],
                            'ideal_price': new_data['ideal_price'],
                            'nrp': new_data['nrp'],
                        }
                    )
                    
                    if created:
                        created_count += 1
                    else:
                        updated_count += 1
                        
                except Exception as e:
                    errors.append(f"{model}: {str(e)}")
        
        # Clear session
        if 'csv_changes' in request.session:
            del request.session['csv_changes']
        
        return JsonResponse({
            'success': True,
            'created': created_count,
            'updated': updated_count,
            'errors': errors
        })
        
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@login_required
def admin_bulk_price(request):
    """Bulk price update page"""
    return render(request, 'calculator/admin/bulk_price.html')


@login_required
@require_POST
def admin_bulk_price_update(request):
    """Handle bulk price update with preview/confirm flow - supports ideal_price AND nrp"""
    import json
    
    # Check if this is a preview request (CSV upload) or confirm request (JSON data)
    content_type = request.content_type
    
    # STEP 1: Preview Mode (CSV Upload)
    if 'multipart/form-data' in content_type or request.FILES:
        try:
            csv_file = request.FILES.get('price_csv')
            
            if not csv_file:
                return JsonResponse({'success': False, 'error': 'No file uploaded'}, status=400)
            
            if not csv_file.name.endswith('.csv'):
                return JsonResponse({'success': False, 'error': 'File must be CSV'}, status=400)
            
            # Read CSV
            decoded_file = csv_file.read().decode('utf-8')
            io_string = io.StringIO(decoded_file)
            reader = csv.DictReader(io_string)
            
            changes = []
            skipped = []
            
            for row_num, row in enumerate(reader, start=2):
                # Try different column name variations for model
                model = (
                    row.get('model_number', '').strip() or 
                    row.get('tank_model', '').strip() or
                    row.get('model', '').strip()
                )
                
                if not model:
                    skipped.append({
                        'model': f'Row {row_num}',
                        'reason': 'Missing model number'
                    })
                    continue
                
                # Try to get ideal_price
                ideal_price_str = (
                    row.get('ideal_price', '').strip() or
                    row.get('new_price', '').strip() or
                    row.get('price', '').strip()
                )
                
                # Try to get nrp
                nrp_str = row.get('nrp', '').strip()
                
                # At least one price must be provided
                if not ideal_price_str and not nrp_str:
                    skipped.append({
                        'model': model,
                        'reason': 'Missing price data (need ideal_price or nrp or both)'
                    })
                    continue
                
                try:
                    # Find tank in database
                    tank = Tank.objects.filter(model=model).first()
                    
                    if not tank:
                        skipped.append({
                            'model': model,
                            'reason': 'Tank not found in database'
                        })
                        continue
                    
                    # Parse prices
                    new_ideal_price = None
                    new_nrp = None
                    
                    if ideal_price_str:
                        ideal_price_str = ideal_price_str.replace('₹', '').replace(',', '').strip()
                        new_ideal_price = float(ideal_price_str)
                        if new_ideal_price <= 0:
                            raise ValueError("Ideal price must be greater than 0")
                    
                    if nrp_str:
                        nrp_str = nrp_str.replace('₹', '').replace(',', '').strip()
                        new_nrp = float(nrp_str)
                        if new_nrp <= 0:
                            raise ValueError("NRP must be greater than 0")
                    
                    # Create change object
                    change_data = {
                        'model': tank.model,
                        'tank_id': tank.id,
                        'category': tank.category,
                        'old_ideal_price': float(tank.ideal_price),
                        'old_nrp': float(tank.nrp),
                    }
                    
                    # Add new prices if provided
                    if new_ideal_price is not None:
                        change_data['new_ideal_price'] = new_ideal_price
                    else:
                        change_data['new_ideal_price'] = float(tank.ideal_price)  # Keep old
                    
                    if new_nrp is not None:
                        change_data['new_nrp'] = new_nrp
                    else:
                        change_data['new_nrp'] = float(tank.nrp)  # Keep old
                    
                    changes.append(change_data)
                    
                except (ValueError, InvalidOperation) as e:
                    skipped.append({
                        'model': model,
                        'reason': f'Invalid price format: {str(e)}'
                    })
                except Exception as e:
                    skipped.append({
                        'model': model,
                        'reason': str(e)
                    })
            
            # Store changes in session for confirmation step
            request.session['bulk_price_changes'] = changes
            
            return JsonResponse({
                'success': True,
                'changes': changes,
                'skipped': skipped,
                'summary': {
                    'total': len(changes) + len(skipped),
                    'to_update': len(changes),
                    'skipped': len(skipped)
                }
            })
            
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)}, status=500)
    
    # STEP 2: Confirm Mode (Apply changes)
    else:
        try:
            # Parse JSON body
            body = json.loads(request.body)
            changes = body.get('changes', [])
            
            if not changes:
                # Try to get from session as fallback
                changes = request.session.get('bulk_price_changes', [])
            
            if not changes:
                return JsonResponse({'success': False, 'error': 'No changes to apply'}, status=400)
            
            updated_count = 0
            errors = []
            
            with transaction.atomic():
                for change in changes:
                    try:
                        tank_id = change.get('tank_id')
                        model = change.get('model')
                        new_ideal_price = change.get('new_ideal_price')
                        new_nrp = change.get('new_nrp')
                        
                        if not tank_id:
                            errors.append(f"{model}: Missing tank ID")
                            continue
                        
                        # Validate prices
                        if new_ideal_price and float(new_ideal_price) <= 0:
                            errors.append(f"{model}: Ideal price must be greater than 0")
                            continue
                        
                        if new_nrp and float(new_nrp) <= 0:
                            errors.append(f"{model}: NRP must be greater than 0")
                            continue
                        
                        # Get tank and update prices
                        tank = Tank.objects.get(id=tank_id)
                        
                        update_fields = []
                        
                        if new_ideal_price is not None:
                            tank.ideal_price = Decimal(str(new_ideal_price))
                            update_fields.append('ideal_price')
                        
                        if new_nrp is not None:
                            tank.nrp = Decimal(str(new_nrp))
                            update_fields.append('nrp')
                        
                        if update_fields:
                            update_fields.append('updated_at')
                            tank.save(update_fields=update_fields)
                            updated_count += 1
                        
                    except Tank.DoesNotExist:
                        errors.append(f"{model}: Tank not found")
                    except Exception as e:
                        errors.append(f"{model}: {str(e)}")
            
            # Clear session after successful update
            if 'bulk_price_changes' in request.session:
                del request.session['bulk_price_changes']
            
            return JsonResponse({
                'success': True,
                'updated': updated_count,
                'errors': errors
            })
            
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)}, status=500)


@login_required
def admin_tank_export(request):

    export_type = request.GET.get("type", "all")

    # Always define tanks first
    tanks = Tank.objects.all().order_by('-updated_at')

    # === Filename logic ===
    if export_type == "all":
        filename = "all_tanks"

    elif export_type == "active":
        filename = "active_tanks"
        tanks = tanks.filter(is_active=True)

    elif export_type == "inactive":
        filename = "inactive_tanks"
        tanks = tanks.filter(is_active=False)

    elif export_type == "modified_today":
        from django.utils.timezone import now
        today = now().date()
        filename = "modified_today_tanks"
        tanks = tanks.filter(updated_at__date=today)

    else:
        # Category export (GFS, RCT, SST, FM etc)
        filename = f"{export_type.lower()}_tanks"
        tanks = tanks.filter(category=export_type)

    # === Create CSV ===
    response = HttpResponse(content_type="text/csv")
    response['Content-Disposition'] = f'attachment; filename="{filename}.csv"'

    writer = csv.writer(response)

    writer.writerow([
        "ID",
        "Model",
        "Category",
        "Diameter",
        "Height",
        "Net Capacity",
        "Gross Capacity",
        "Ideal Price",
        "NRP",
        "Status",
        "Last Updated"
    ])

    for tank in tanks:
        writer.writerow([
            tank.id,
            tank.model,
            tank.get_category_display(),
            tank.diameter,
            tank.height,
            tank.net_capacity,
            tank.gross_capacity,
            tank.ideal_price,
            tank.nrp,
            "Active" if tank.is_active else "Inactive",
            tank.updated_at.strftime("%Y-%m-%d %H:%M"),
        ])

    return response
