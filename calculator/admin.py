from django.contrib import admin
from .models import Tank, TankCapacity


class TankCapacityInline(admin.TabularInline):
    model = TankCapacity
    extra = 0


@admin.register(Tank)
class TankAdmin(admin.ModelAdmin):
    list_display = ("tank_type", "model", "diameter")
    list_filter = ("tank_type",)
    search_fields = ("model",)
    inlines = [TankCapacityInline]
