from django.urls import path
from . import views, admin_views

urlpatterns = [
    # Public routes
    path("", views.home, name="home"),
    path("api/search/", views.tank_search, name="tank_search"),
    path("api/models/", views.get_models_for_type, name="get_models"),
    path("api/stats/", views.get_category_stats, name="get_stats"),
    
    # Admin routes
    path("admin-dashboard/", admin_views.admin_dashboard, name="admin_dashboard"),
    path("admin-dashboard/tanks/", admin_views.admin_tank_list, name="admin_tank_list"),
    path("admin-dashboard/tank/update/", admin_views.admin_tank_update, name="admin_tank_update"),
    path("admin-dashboard/tank/toggle/", admin_views.admin_tank_toggle, name="admin_tank_toggle"),
    path("admin-dashboard/csv/upload/", admin_views.admin_csv_upload, name="admin_csv_upload"),
    path("admin-dashboard/csv/preview/", admin_views.admin_csv_preview, name="admin_csv_preview"),
    path("admin-dashboard/csv/confirm/", admin_views.admin_csv_confirm, name="admin_csv_confirm"),
    path("admin-dashboard/bulk-price/", admin_views.admin_bulk_price, name="admin_bulk_price"),
    path("admin-dashboard/bulk-price/update/", admin_views.admin_bulk_price_update, name="admin_bulk_price_update"),
]