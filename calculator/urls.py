from django.urls import path
from .views import home, tank_search, get_models_for_type, get_category_stats


urlpatterns = [
    path("", home, name="home"),
    path("api/search/", tank_search, name="tank_search"),
    path("api/models/", get_models_for_type, name="get_models"),
    path("api/stats/", get_category_stats, name="category_stats"),  
]