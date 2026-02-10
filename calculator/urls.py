from django.urls import path
from .views import home, tank_search, get_models_for_type


urlpatterns = [
    path("", home, name="home"),
    path("api/search/", tank_search, name="tank_search"),
    # path("api/tank-types/", get_tank_type_info, name="tank_type_info"),
    path("api/models/", get_models_for_type, name="get_models"),
]