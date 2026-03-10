from django.http import JsonResponse, HttpResponse
from django.shortcuts import render, redirect
from django.db.models import Q
from django.db.models.functions import Cast
from django.db.models import FloatField
import csv
import json
import os
import time
import hashlib
from django.contrib import messages
from .models import Tank
from django.contrib.auth import authenticate, login, logout
from django.views.decorators.http import require_POST,require_GET
from django.views.decorators.csrf import csrf_exempt

# ── Nexus DB connection ───────────────────────────────────────────────────────
def get_nexus_connection():
    import psycopg2
    return psycopg2.connect(
        host     = os.environ.get('NEXUS_DB_HOST',     'localhost'),
        dbname   = os.environ.get('NEXUS_DB_NAME',     'STLPL'),
        user     = os.environ.get('NEXUS_DB_USER',     'server'),
        password = os.environ.get('NEXUS_DB_PASSWORD', ''),
        port     = int(os.environ.get('NEXUS_DB_PORT', 5432)),
        connect_timeout = 8,
    )


def _parse_payload(raw):
    """
    psycopg2 returns JSONB columns as a Python list/dict already.
    TEXT columns come back as a string. Handle both.
    """
    if raw is None:
        return []
    if isinstance(raw, (list, dict)):
        return raw if isinstance(raw, list) else [raw]
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


# ── Field mapper: TankMate → Nexus payload format ────────────────────────────
def map_tank_to_nexus(tank):
    unique_id = f"{tank.get('model', '')}-{int(time.time() * 1000)}"
    return {
        "id":             unique_id,
        "tankModel":      tank.get("model", ""),
        "tankHeight":     str(tank.get("height", "")),
        "tankDiameter":   str(tank.get("diameter", "")),
        "grossCapacity":  tank.get("gross_capacity", 0),
        "netCapacity":    tank.get("net_capacity", 0),
        "tankCost":       tank.get("ideal_price", 0),
        "nozzleRating":   "",
        "nozzleMaterial": "",
        "antivortexList": [],
        "nozzlesList":    [],
        "accessoriesList":[],
        "nozzlesCost":    0,
        "antiNozCost":    0,
        "accessoriesCost":0,
        "total":          tank.get("ideal_price", 0),
    }



# ══════════════════════════════════════════════════════════════════════════════
# NEXUS API ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

def get_nexus_users(request):
    """
    Returns distinct salesperson names from Nexus.
    """
    try:
        conn = get_nexus_connection()
        cur  = conn.cursor()
        cur.execute("""
            SELECT DISTINCT sales_person
            FROM   nexus.pricing_logs
            WHERE  sales_person IS NOT NULL
              AND  sales_person <> ''
            ORDER  BY sales_person
        """)
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return JsonResponse({"users": [{"name": r[0]} for r in rows]})
    except Exception as e:
        return JsonResponse({"error": str(e), "users": []}, status=500)


@csrf_exempt
def export_to_nexus(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST only'}, status=405)
    try:
        body         = json.loads(request.body)
        client_name  = body.get('client_name',  '').strip()
        sales_person = body.get('sales_person', '').strip()
        tanks        = body.get('tanks', [])

        if not client_name:
            return JsonResponse({'error': 'client_name is required'}, status=400)
        if not sales_person:
            return JsonResponse({'error': 'sales_person is required'}, status=400)
        if not tanks:
            return JsonResponse({'error': 'No tanks in collection'}, status=400)

        nexus_payload = [map_tank_to_nexus(t) for t in tanks]

        # ── Compute hash of what we're about to export ──────────────────────
        export_hash = _compute_payload_hash(nexus_payload)

        # ── Write to Nexus DB ────────────────────────────────────────────────
        conn = get_nexus_connection()
        cur  = conn.cursor()
        cur.execute("""
            INSERT INTO nexus.pricing_logs (client_name, sales_person, payload)
            VALUES (%s, %s, %s::jsonb)
            RETURNING log_id
        """, (client_name, sales_person, json.dumps(nexus_payload)))
        log_id = cur.fetchone()[0]
        conn.commit()
        cur.close()
        conn.close()

        # ── Save export log with hash in TankMate's local DB ─────────────────
        # This is the record we'll check against on import
        from .models import NexusExportLog
        NexusExportLog.objects.update_or_create(
            log_id=log_id,
            defaults={
                'client_name':  client_name,
                'sales_person': sales_person,
                'tank_count':   len(nexus_payload),
                'payload':      nexus_payload,
                'export_hash':  export_hash,      # ← THE KEY FIELD
                'is_modified':  False,
            }
        )

        NEXUS_BASE_URL = os.environ.get('NEXUS_BASE_URL', 'https://nexus.shubhamtanks.org')
        return JsonResponse({
            'success':      True,
            'log_id':       log_id,
            'redirect_url': f"{NEXUS_BASE_URL}/log/{log_id}",
        })
    except Exception as e:
        import traceback; traceback.print_exc()
        return JsonResponse({'error': str(e)}, status=500)


# ══════════════════════════════════════════════════════════════════════════════
# EXISTING VIEWS (unchanged)
# ══════════════════════════════════════════════════════════════════════════════

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
    return render(request, "calculator/home.html")


def tank_search(request):
    category       = request.GET.get("category")
    capacity_value = request.GET.get("capacity")
    model_value    = request.GET.get("model")
    diameter_value = request.GET.get("diameter")
    height_value   = request.GET.get("height")
    min_price      = request.GET.get("min_price")
    max_price      = request.GET.get("max_price")
    sort_by        = request.GET.get("sort_by", "capacity")

    results = []
    search_info = {"category": category or "all", "search_type": None}

    if category:
        base_query = Tank.objects.filter(category=category.upper(), is_active=True)
    else:
        base_query = Tank.objects.filter(is_active=True)

    if model_value and model_value.strip():
        tanks = base_query.filter(model__icontains=model_value.strip())
        for tank in tanks:
            results.append(format_tank_result(tank))
        search_info["search_type"] = "model"
        search_info["query"] = model_value.strip()

    elif diameter_value and height_value:
        try:
            target_diameter = float(diameter_value)
            target_height   = float(height_value)
            tolerance = 0.9
            tanks = base_query.filter(
                diameter__gte=target_diameter - tolerance,
                diameter__lte=target_diameter + tolerance,
                height__gte=target_height - tolerance,
                height__lte=target_height + tolerance,
            )
            dimension_results = []
            for tank in tanks:
                diameter_diff = abs(tank.diameter - target_diameter)
                height_diff   = abs(tank.height - target_height)
                dimension_results.append({
                    "tank": tank, "score": diameter_diff + height_diff,
                    "diameter_diff": round(diameter_diff, 2),
                    "height_diff":   round(height_diff, 2),
                })
            dimension_results.sort(key=lambda x: x["score"])
            for item in dimension_results[:20]:
                result = format_tank_result(item["tank"])
                result.update({"match_type": "approximate",
                                "diameter_diff": item["diameter_diff"],
                                "height_diff":   item["height_diff"]})
                results.append(result)
            search_info.update({"search_type": "dimensions",
                                 "diameter": target_diameter,
                                 "height": target_height})
        except (ValueError, TypeError):
            return JsonResponse({"error": "Invalid dimension values"}, status=400)

    elif capacity_value:
        try:
            target_capacity = float(capacity_value)
            tolerance = 0.15
            tanks = base_query.filter(
                net_capacity__gte=target_capacity * (1 - tolerance),
                net_capacity__lte=target_capacity * (1 + tolerance),
            )
            capacity_results = sorted(
                [{"tank": t, "diff": abs(t.net_capacity - target_capacity)} for t in tanks],
                key=lambda x: x["diff"]
            )[:20]
            for item in capacity_results:
                result = format_tank_result(item["tank"])
                result["match_difference"] = round(item["diff"], 2)
                diff = item["diff"]
                result["match_label"] = (
                    "Exact Match" if diff < 1
                    else "Higher Capacity Option" if item["tank"].net_capacity > target_capacity
                    else "Closest Match"
                )
                results.append(result)
            search_info.update({"search_type": "capacity", "capacity_kl": target_capacity})
        except (ValueError, TypeError):
            return JsonResponse({"error": "Invalid capacity value"}, status=400)

    elif diameter_value:
        try:
            target_diameter = float(diameter_value)
            tolerance = 0.9
            tanks = base_query.filter(
                diameter__gte=target_diameter - tolerance,
                diameter__lte=target_diameter + tolerance,
            ).order_by('diameter', 'net_capacity')[:20]
            for tank in tanks:
                results.append(format_tank_result(tank))
            search_info.update({"search_type": "diameter", "diameter": target_diameter})
        except (ValueError, TypeError):
            return JsonResponse({"error": "Invalid diameter value"}, status=400)

    elif height_value:
        try:
            target_height = float(height_value)
            tolerance = 0.9
            tanks = base_query.filter(
                height__gte=target_height - tolerance,
                height__lte=target_height + tolerance,
            ).order_by('height', 'net_capacity')[:20]
            for tank in tanks:
                results.append(format_tank_result(tank))
            search_info.update({"search_type": "height", "height": target_height})
        except (ValueError, TypeError):
            return JsonResponse({"error": "Invalid height value"}, status=400)

    else:
        tanks = base_query.order_by('net_capacity')[:50]
        for tank in tanks:
            results.append(format_tank_result(tank))
        search_info["search_type"] = "browse"

    if min_price or max_price:
        try:
            filtered = []
            for r in results:
                price = float(r["ideal_price"])
                if min_price and price < float(min_price):
                    continue
                if max_price and price > float(max_price):
                    continue
                filtered.append(r)
            results = filtered
            search_info["price_filtered"] = True
        except (ValueError, TypeError):
            return JsonResponse({"error": "Invalid price values"}, status=400)

    if sort_by == "price_asc":
        results.sort(key=lambda x: float(x["ideal_price"]))
        search_info["sorted_by"] = "price_low_to_high"
    elif sort_by == "price_desc":
        results.sort(key=lambda x: float(x["ideal_price"]), reverse=True)
        search_info["sorted_by"] = "price_high_to_low"
    elif sort_by == "capacity":
        results.sort(key=lambda x: x["net_capacity"])
        search_info["sorted_by"] = "capacity_low_to_high"

    return JsonResponse({"results": results, "search_info": search_info, "count": len(results)})


def format_tank_result(tank):
    return {
        "category":               tank.category,
        "category_name":          tank.get_category_display_name(),
        "model":                  tank.model,
        "diameter":               tank.diameter,
        "height":                 tank.height,
        "net_capacity":           tank.net_capacity,
        "gross_capacity":         tank.gross_capacity,
        "capacity_display":       tank.get_capacity_display(),
        "gross_capacity_display": tank.get_gross_capacity_display(),
        "ideal_price":            float(tank.ideal_price),
        "nrp":                    float(tank.nrp),
        "price_display":          tank.get_price_display(),
        "nrp_display":            tank.get_nrp_display(),
        "dimensions_display":     tank.get_dimensions_display(),
        "price_per_kl":           round(tank.price_per_kl, 2) if tank.price_per_kl else 0,
    }


def get_models_for_type(request):
    category = request.GET.get("category")
    query    = request.GET.get("q", "").strip()
    if len(query) < 2:
        return JsonResponse({"models": [], "count": 0})

    tanks = Tank.objects.filter(category=category.upper()) if category else Tank.objects.all()
    tanks = tanks.filter(Q(model__icontains=query)).order_by('diameter', 'height')[:50]

    models = [{
        "model":         tank.model,
        "category":      tank.category,
        "category_name": tank.get_category_display_name(),
        "diameter":      tank.diameter,
        "height":        tank.height,
        "net_capacity":  tank.net_capacity,
        "price":         float(tank.ideal_price),
    } for tank in tanks]

    return JsonResponse({"models": models, "count": len(models)})


def get_category_stats(request):
    stats = {}
    for category_code, category_name in Tank.CATEGORY_CHOICES:
        tanks = Tank.objects.filter(category=category_code)
        count = tanks.count()
        if count > 0:
            stats[category_code] = {
                "name":         category_name,
                "count":        count,
                "min_capacity": tanks.order_by('net_capacity').first().net_capacity,
                "max_capacity": tanks.order_by('-net_capacity').first().net_capacity,
                "min_price":    float(tanks.order_by('ideal_price').first().ideal_price),
                "max_price":    float(tanks.order_by('-ideal_price').first().ideal_price),
            }
    all_tanks = Tank.objects.all()
    stats["ALL"] = {
        "name":         "Universal Search",
        "count":        all_tanks.count(),
        "min_capacity": all_tanks.order_by('net_capacity').first().net_capacity if all_tanks.exists() else 0,
        "max_capacity": all_tanks.order_by('-net_capacity').first().net_capacity if all_tanks.exists() else 0,
        "min_price":    float(all_tanks.order_by('ideal_price').first().ideal_price) if all_tanks.exists() else 0,
        "max_price":    float(all_tanks.order_by('-ideal_price').first().ideal_price) if all_tanks.exists() else 0,
    }
    return JsonResponse({"stats": stats})


def download_tank_template(request):
    response = HttpResponse(content_type='text/csv')
    response['Content-Disposition'] = 'attachment; filename="tank_template.csv"'
    writer = csv.writer(response)
    writer.writerow(['id', 'tank_model', 'diameter', 'height',
                     'net_capacity', 'gross_capacity', 'ideal_price', 'nrp'])
    return response


def check_nexus_duplicate(request):
    sales_person = request.GET.get('sales_person', '').strip()
    q            = request.GET.get('q', '').strip()

    if not sales_person or len(q) < 2:
        return JsonResponse({'matches': []})

    try:
        conn = get_nexus_connection()
        cur  = conn.cursor()
        cur.execute("""
            SELECT log_id, client_name, created_at, payload
            FROM   nexus.pricing_logs
            WHERE  LOWER(sales_person) = LOWER(%s)
              AND  LOWER(client_name)  LIKE LOWER(%s)
            ORDER  BY created_at DESC
            LIMIT  6
        """, (sales_person, f'%{q}%'))
        rows = cur.fetchall()
        cur.close()
        conn.close()
    except Exception as e:
        return JsonResponse({'matches': [], 'error': str(e)}, status=500)

    from .models import NexusExportLog
    local_logs = {
        log.log_id: log
        for log in NexusExportLog.objects.filter(
            sales_person__iexact=sales_person,
            log_id__in=[r[0] for r in rows]
        )
    }

    matches = []
    for log_id, client_name, created_at, raw_payload in rows:
        payload     = _parse_payload(raw_payload)
        local_log   = local_logs.get(log_id)
        export_hash = local_log.export_hash if local_log else None
        is_modified = _payload_is_modified(export_hash, payload)

        matches.append({
            'log_id':      log_id,
            'client_name': client_name,
            'tank_count':  len(payload),
            'created_at':  created_at.strftime('%d %b %Y') if created_at else '',
            'is_locked':   is_modified,
            'can_import':  not is_modified,
        })

    return JsonResponse({'matches': matches})

## ── ALSO ADD THIS to get_nexus_projects if not already present ──────
## (used by "My Projects" modal - same pattern but no search filter)

def get_nexus_projects(request):
    """
    Returns all past projects for a salesperson.
    For each project, checks if Nexus payload has been modified
    since TankMate exported it (using hash comparison).
    """
    sales_person = request.GET.get('sales_person', '').strip()
    if not sales_person:
        return JsonResponse({'error': 'sales_person required', 'projects': []}, status=400)

    try:
        conn = get_nexus_connection()
        cur  = conn.cursor()
        cur.execute("""
            SELECT log_id, client_name, created_at, payload
            FROM   nexus.pricing_logs
            WHERE  LOWER(sales_person) = LOWER(%s)
            ORDER  BY created_at DESC
            LIMIT  50
        """, (sales_person,))
        rows = cur.fetchall()
        cur.close()
        conn.close()
    except Exception as e:
        import traceback; traceback.print_exc()
        return JsonResponse({'error': str(e), 'projects': []}, status=500)

    # ── Load all local export logs for this salesperson in ONE query ──────────
    # This is fast: one SQLite SELECT, no loops, no N+1 queries
    from .models import NexusExportLog
    local_logs = {
        log.log_id: log
        for log in NexusExportLog.objects.filter(sales_person__iexact=sales_person)
    }

    projects = []
    for log_id, client_name, created_at, raw_payload in rows:
        payload    = _parse_payload(raw_payload)
        tank_count = len(payload)
        
        # ── Determine lock status ─────────────────────────────────────────────
        local_log    = local_logs.get(log_id)
        export_hash  = local_log.export_hash if local_log else None
        is_modified  = _payload_is_modified(export_hash, payload)
        
        # If we detect modification, persist it to local DB so we don't
        # recompute next time (auto-lock on first detection)
        if is_modified and local_log and not local_log.is_modified:
            local_log.is_modified       = True
            local_log.modification_type = 'nexus_modified'
            local_log.save(update_fields=['is_modified', 'modification_type', 'updated_at'])

        lock_reason = None
        if is_modified:
            # Try to give a specific reason
            if _payload_has_accessories(payload):
                lock_reason = 'Accessories were added in Nexus'
            else:
                lock_reason = 'Collection was edited in Nexus'

        projects.append({
            'log_id':      log_id,
            'client_name': client_name,
            'tank_count':  tank_count,
            'created_at':  created_at.strftime('%d %b %Y, %I:%M %p') if created_at else '',
            'payload':     payload,
            # ── Lock fields — frontend uses these ──────────────────────────
            'is_locked':   is_modified,
            'lock_reason': lock_reason,
            'can_import':  not is_modified,
        })

    return JsonResponse({'projects': projects})



def _compute_payload_hash(tanks: list) -> str:
    """
    Compute a stable SHA-256 hash of the base tank fields only.
    
    We hash ONLY the fields TankMate originally sent — not accessories.
    This means:
      - If Nexus adds accessories → hash changes → LOCKED
      - If nothing changes → hash matches → ALLOWED
    
    Sorting keys and the list itself ensures the hash is stable
    regardless of field insertion order.
    """
    BASE_FIELDS = ['tankModel', 'tankHeight', 'tankDiameter',
                   'netCapacity', 'grossCapacity', 'tankCost']
    
    # Extract only base fields, sorted by tankModel for stability
    normalized = []
    for tank in tanks:
        if not isinstance(tank, dict):
            continue
        entry = {f: tank.get(f, '') for f in BASE_FIELDS}
        normalized.append(entry)
    
    # Sort by tankModel so order doesn't matter
    normalized.sort(key=lambda x: str(x.get('tankModel', '')))
    
    # Serialize with sorted keys for determinism
    serialized = json.dumps(normalized, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(serialized.encode('utf-8')).hexdigest()


def _payload_is_modified(original_hash: str, current_payload: list) -> bool:
    """
    Returns True if the current Nexus payload differs from what TankMate exported.
    True = LOCKED (changes detected)
    False = CLEAN (safe to import)
    """
    if not original_hash:
        # No hash stored = old export before this system existed
        # Fall back to accessory detection for backwards compatibility
        return _payload_has_accessories(current_payload)
    
    current_hash = _compute_payload_hash(current_payload)
    return current_hash != original_hash

def _payload_has_accessories(payload):
    """Check if Nexus has added accessories to any tank in the payload."""
    if not payload or not isinstance(payload, list):
        return False
    for tank in payload:
        if not isinstance(tank, dict):
            continue
        if tank.get('accessoriesList') and len(tank.get('accessoriesList', [])) > 0:
            return True
        if float(tank.get('accessoriesCost', 0) or 0) > 0:
            return True
        if tank.get('nozzlesList') and len(tank.get('nozzlesList', [])) > 0:
            return True
        if tank.get('antivortexList') and len(tank.get('antivortexList', [])) > 0:
            return True
    return False