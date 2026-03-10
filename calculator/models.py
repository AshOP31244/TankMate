from django.db import models
from django.utils import timezone

class Tank(models.Model):
    """
    Unified Tank Model - Simplified Structure
    
    Each row in tanks.csv = One Tank object
    No more complex Tank/TankCapacity split
    
    Model name already includes height (e.g., RCT15-22, SST40-36(ETP))
    Category extracted from model prefix (RCT, SST, SFM, GFS)
    """
    
    CATEGORY_CHOICES = [
        ('RCT', 'Rhino Commercial Tank'),
        ('SST', 'SecureStore Micro-Coated Tanks'),
        ('SFM', 'Factory Mutual Tank'),
        ('GFS', 'Glass Fused Tank'),
    ]
    
    # Core identification
    model = models.CharField(
        max_length=50,
        unique=True,
        db_index=True,
        help_text="Full model name with height (e.g., RCT15-22, SST40-36(ETP))"
    )
    
    category = models.CharField(
        max_length=10,
        choices=CATEGORY_CHOICES,
        db_index=True,
        help_text="Tank category: RCT, SST, SFM, GFS"
    )
    
    # Physical dimensions
    diameter = models.FloatField(
        help_text="Tank diameter in meters"
    )
    
    height = models.FloatField(
        help_text="Tank height in meters"
    )
    
    # Capacity fields (NEW!)
    net_capacity = models.FloatField(
        help_text="Net capacity in KL (Kiloliters)"
    )
    
    gross_capacity = models.FloatField(
        help_text="Gross capacity in KL (Kiloliters)"
    )
    
    # Pricing fields (NEW!)
    ideal_price = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        help_text="Ideal selling price in ₹"
    )
    
    nrp = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        help_text="No Regret Price in ₹"
    )
    

    is_active = models.BooleanField(
        default=True,
        db_index=True,
        help_text="Active tanks appear in public search. Inactive tanks are hidden."
    )

    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['category', 'model']
        indexes = [
            models.Index(fields=['category', 'net_capacity']),
            models.Index(fields=['category', 'ideal_price']),
            models.Index(fields=['diameter', 'height']),
        ]
        verbose_name = "Tank"
        verbose_name_plural = "Tanks"
    
    def __str__(self):
        return f"{self.category} - {self.model}"
    
    # ==================== Display Methods ====================
    
    def get_category_display_name(self):
        """Returns full category name"""
        return dict(self.CATEGORY_CHOICES).get(self.category, self.category)
    
    def get_capacity_display(self):
        """Returns formatted net capacity"""
        return f"{self.net_capacity:,.2f} KL"
    
    def get_gross_capacity_display(self):
        """Returns formatted gross capacity"""
        return f"{self.gross_capacity:,.2f} KL"
    
    def get_price_display(self):
        """Returns formatted ideal price"""
        return f"₹{self.ideal_price:,.0f}"
    
    def get_nrp_display(self):
        """Returns formatted NRP"""
        return f"₹{self.nrp:,.0f}"
    
    def get_dimensions_display(self):
        """Returns formatted dimensions"""
        return f"Ø{self.diameter}m × {self.height}m"
    
    # ==================== Utility Methods ====================
    
    @property
    def volume_m3(self):
        """Calculate cylindrical volume in m³"""
        import math
        radius = self.diameter / 2
        return math.pi * (radius ** 2) * self.height
    
    @property
    def capacity_difference(self):
        """Difference between gross and net capacity"""
        return self.gross_capacity - self.net_capacity
    
    @property
    def price_per_kl(self):
        """Price per kiloliter"""
        if self.net_capacity > 0:
            return float(self.ideal_price) / self.net_capacity
        return 0
    
    def is_in_capacity_range(self, min_kl, max_kl):
        """Check if tank is within capacity range"""
        return min_kl <= self.net_capacity <= max_kl
    
    def is_in_price_range(self, min_price, max_price):
        """Check if tank is within price range"""
        return min_price <= float(self.ideal_price) <= max_price
    
    # ==================== Search Helpers ====================
    
    @staticmethod
    def extract_category_from_model(model_name):
        """Extract category from model name"""
        model_upper = model_name.upper()
        if model_upper.startswith('RCT'):
            return 'RCT'
        elif model_upper.startswith('SST'):
            return 'SST'
        elif model_upper.startswith('SFM'):
            return 'SFM'
        elif model_upper.startswith('GFS'):
            return 'GFS'
        return None
    
    @staticmethod
    def find_nearest_capacity(target_capacity, tolerance_percent=0.10):
        """
        Find tanks near target capacity
        Returns QuerySet sorted by closeness
        """
        from django.db.models import F, ExpressionWrapper, FloatField
        from django.db.models.functions import Abs
        
        # Calculate absolute difference
        return Tank.objects.annotate(
            capacity_diff=Abs(F('net_capacity') - target_capacity)
        ).filter(
            capacity_diff__lte=target_capacity * tolerance_percent
        ).order_by('capacity_diff')
    
    @staticmethod
    def find_by_dimensions(diameter, height, tolerance=0.5):
        """
        Find tanks matching dimensions within tolerance
        """
        return Tank.objects.filter(
            diameter__gte=diameter - tolerance,
            diameter__lte=diameter + tolerance,
            height__gte=height - tolerance,
            height__lte=height + tolerance
        )
    
    # ==================== Admin Display ====================
    
    def admin_display_capacity(self):
        """For Django admin display"""
        return f"Net: {self.net_capacity} KL | Gross: {self.gross_capacity} KL"
    admin_display_capacity.short_description = "Capacity"
    
    def admin_display_price(self):
        """For Django admin display"""
        return f"₹{self.ideal_price:,.0f}"
    admin_display_price.short_description = "Price"


class NexusExportLog(models.Model):
    """
    Tracks all exports from TankMate to Nexus.
    Implements lock mechanism to prevent data loss.
    """
    
    # Core fields
    log_id = models.CharField(max_length=100, unique=True, db_index=True)
    client_name = models.CharField(max_length=255, db_index=True)
    sales_person = models.CharField(max_length=255, db_index=True)
    tank_count = models.IntegerField(default=0)
    payload = models.JSONField()
    
    export_hash = models.CharField(max_length=64, null=True, blank=True)
    
    # 🔐 Lock System
    is_modified = models.BooleanField(default=False, db_index=True, 
                                       help_text="True if collection modified in Nexus")
    modification_type = models.CharField(max_length=50, null=True, blank=True,
                                          help_text="e.g., 'accessories_added', 'tanks_edited'")
    modified_at = models.DateTimeField(null=True, blank=True)
    modified_by = models.CharField(max_length=255, null=True, blank=True)
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'nexus_export_log'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['sales_person', 'client_name']),
            models.Index(fields=['sales_person', 'is_modified']),
        ]
    
    def __str__(self):
        status = "🔒 LOCKED" if self.is_modified else "✅ Editable"
        return f"{self.client_name} (#{self.log_id}) - {status}"
    
    def lock(self, modification_type='accessories_added', modified_by=None):
        """Lock this collection from further edits"""
        self.is_modified = True
        self.modification_type = modification_type
        self.modified_at = timezone.now()
        self.modified_by = modified_by
        self.save(update_fields=['is_modified', 'modification_type', 'modified_at', 'modified_by', 'updated_at'])
    
    def unlock(self):
        """Unlock this collection (use with caution)"""
        self.is_modified = False
        self.modification_type = None
        self.modified_at = None
        self.modified_by = None
        self.save(update_fields=['is_modified', 'modification_type', 'modified_at', 'modified_by', 'updated_at'])
    
    def can_reimport(self):
        """Check if this collection can be imported back to TankMate"""
        return not self.is_modified
    
    def can_reexport(self):
        """Check if this collection can be exported again from TankMate"""
        return not self.is_modified