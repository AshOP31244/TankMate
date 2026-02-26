from django.contrib import admin
from .models import Tank




@admin.register(Tank)
class TankAdmin(admin.ModelAdmin):
    # use existing fields on Tank model
    list_display = ("category", "model", "diameter")
    list_filter = ("category",)
    search_fields = ("model",)
    # no inlines needed

