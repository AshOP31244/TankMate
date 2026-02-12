from django.db import models


class Tank(models.Model):
    TANK_TYPES = (
        ("RCT", "Rhino Commercial Tank"),
        ("SST", "SecureStore Micro-Coated Tanks"),
        ("FM", "Factory Mutual Tank"),
    )

    tank_type = models.CharField(max_length=10, choices=TANK_TYPES)
    model = models.CharField(max_length=20)
    diameter = models.FloatField(help_text="Diameter in meters")

    class Meta:
        unique_together = ("tank_type", "model")
        ordering = ["tank_type", "model"]

    def __str__(self):
        return f"{self.tank_type} - {self.model}"

    def get_capacity_unit(self):
        """Returns the capacity unit for display"""
        if self.tank_type == "SST":
            return "m³"
        return "Litres"

    def get_capacity_unit_display(self):
        """Returns full capacity unit description"""
        if self.tank_type == "SST":
            return "Cubic Meters (m³)"
        return "Litres (L)"

    def get_display_name_with_height(self, height):
        
        # FM models already include height
        if self.tank_type == "FM":
            return self.model

        # Multiply directly to avoid floating point issues
        height_suffix = int(height * 10)

        # RCT → always 2 digits
        if self.tank_type == "RCT":
            height_str = str(height_suffix).zfill(2)

        # SST → also 2 digits (same rule as RCT for consistency)
        else:
            height_str = str(height_suffix)

        return f"{self.model}-{height_str}"





class TankCapacity(models.Model):
    tank = models.ForeignKey(
        Tank,
        on_delete=models.CASCADE,
        related_name="capacities"
    )
    height = models.FloatField(help_text="Height in meters")
    capacity = models.FloatField(help_text="Capacity in source unit (Liters for RCT/FM, m³ for SST)")

    class Meta:
        unique_together = ("tank", "height")
        ordering = ["tank", "height"]

    def __str__(self):
        return f"{self.tank} | {self.height}m | {self.capacity} {self.tank.get_capacity_unit()}"

    def get_capacity_in_kl(self):
        """Convert capacity to KL for consistent display"""
        if self.tank.tank_type == "SST":
            # SST is stored in m³, which is same as KL
            return self.capacity
        else:
            # RCT/FM stored in litres, convert to KL
            return self.capacity / 1000

    def get_capacity_display(self):
        """Returns formatted capacity with unit"""
        unit = self.tank.get_capacity_unit()
        return f"{self.capacity:,.0f} {unit}"

    def get_capacity_kl_display(self):
        """Returns capacity in KL with proper formatting"""
        kl = self.get_capacity_in_kl()
        return f"{kl:,.2f} KL"

    def get_display_model_name(self):
        """Get sales-friendly model name with height"""
        return self.tank.get_display_name_with_height(self.height)

    @staticmethod
    def calculate_volume(diameter, height):
        """Calculate cylindrical volume in cubic meters (KL)"""
        import math
        radius = diameter / 2
        volume_m3 = math.pi * (radius ** 2) * height
        return volume_m3

    @staticmethod
    def find_nearest_height(target_height, available_heights, tolerance=0.5):
        
        if not available_heights:
            return None

        # Normalize input (1 decimal)
        target_height = round(target_height, 1)

        # Find closest
        closest = min(
            available_heights,
            key=lambda h: abs(h - target_height)
        )

        return closest


    @staticmethod
    def find_nearest_diameter(target_diameter, available_diameters, tolerance_percent=0.15):
        """
        Returns diameters sorted by closeness.
        Never returns empty unless no data exists.
        """
        if not available_diameters:
            return []

        # Normalize
        target_diameter = round(target_diameter, 1)

        # Sort by closeness
        sorted_diameters = sorted(
            available_diameters,
            key=lambda d: abs(d - target_diameter)
        )

        # Apply tolerance window
        tolerance = target_diameter * tolerance_percent
        filtered = [
            d for d in sorted_diameters
            if abs(d - target_diameter) <= tolerance
        ]

        return filtered if filtered else sorted_diameters[:3]
