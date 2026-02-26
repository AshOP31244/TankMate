import csv
from django.core.management.base import BaseCommand
from calculator.models import Tank
from pathlib import Path


class Command(BaseCommand):
    help = "Import unified tank data from tanks.csv"

    def add_arguments(self, parser):
        parser.add_argument(
            "--file",
            type=str,
            required=True,
            help="Path to tanks.csv file"
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Clear existing data before import"
        )

    def handle(self, *args, **options):
        file_path = Path(options["file"])

        if not file_path.exists():
            self.stdout.write(self.style.ERROR(f"❌ File not found: {file_path}"))
            return

        # Optional: Clear existing data
        if options["clear"]:
            confirm = input("⚠️  This will delete ALL existing tanks. Continue? (yes/no): ")
            if confirm.lower() == "yes":
                Tank.objects.all().delete()
                self.stdout.write(self.style.WARNING("✓ Cleared all existing data"))
            else:
                self.stdout.write("Import cancelled")
                return

        # Track statistics
        stats = {
            'total': 0,
            'created': 0,
            'updated': 0,
            'skipped': 0,
            'errors': 0,
            'categories': {'RCT': 0, 'SST': 0, 'SFM': 0, 'GFS': 0}
        }

        self.stdout.write("📂 Reading CSV file...")

        with open(file_path, newline="", encoding="utf-8") as csvfile:
            reader = csv.DictReader(csvfile)

            for row_num, row in enumerate(reader, start=2):  # Start at 2 (skip header)
                stats['total'] += 1

                try:
                    # Extract and validate data
                    model = row["tank_model"].strip()
                    diameter = float(row["diameter"])
                    height = float(row["height"])
                    net_capacity = float(row["net_capacity"])
                    gross_capacity = float(row["gross_capacity"])
                    ideal_price = float(row["ideal_price"])
                    nrp = float(row["nrp"])

                    # Extract category from model name
                    category = Tank.extract_category_from_model(model)

                    if not category:
                        self.stdout.write(
                            self.style.WARNING(
                                f"⚠️  Row {row_num}: Could not extract category from '{model}'"
                            )
                        )
                        stats['skipped'] += 1
                        continue

                    # Create or update tank
                    tank, created = Tank.objects.update_or_create(
                        model=model,
                        defaults={
                            'category': category,
                            'diameter': diameter,
                            'height': height,
                            'net_capacity': net_capacity,
                            'gross_capacity': gross_capacity,
                            'ideal_price': ideal_price,
                            'nrp': nrp,
                        }
                    )

                    if created:
                        stats['created'] += 1
                        stats['categories'][category] = stats['categories'].get(category, 0) + 1
                    else:
                        stats['updated'] += 1

                    # Progress indicator (every 100 rows)
                    if stats['total'] % 100 == 0:
                        self.stdout.write(f"📊 Processed {stats['total']} rows...")

                except KeyError as e:
                    self.stdout.write(
                        self.style.ERROR(
                            f"❌ Row {row_num}: Missing column {e}"
                        )
                    )
                    stats['errors'] += 1

                except ValueError as e:
                    self.stdout.write(
                        self.style.ERROR(
                            f"❌ Row {row_num}: Invalid data - {e}"
                        )
                    )
                    stats['errors'] += 1

                except Exception as e:
                    self.stdout.write(
                        self.style.ERROR(
                            f"❌ Row {row_num}: Unexpected error - {e}"
                        )
                    )
                    stats['errors'] += 1

        # Display results
        self.stdout.write("\n" + "="*60)
        self.stdout.write(self.style.SUCCESS("✅ IMPORT COMPLETED"))
        self.stdout.write("="*60)
        
        self.stdout.write(f"📊 Total rows processed: {stats['total']}")
        self.stdout.write(f"✅ Created: {stats['created']}")
        self.stdout.write(f"🔄 Updated: {stats['updated']}")
        self.stdout.write(f"⚠️  Skipped: {stats['skipped']}")
        self.stdout.write(f"❌ Errors: {stats['errors']}")
        
        self.stdout.write("\n📦 BREAKDOWN BY CATEGORY:")
        for category, count in stats['categories'].items():
            percentage = (count / stats['created'] * 100) if stats['created'] > 0 else 0
            self.stdout.write(f"   {category}: {count} ({percentage:.1f}%)")
        
        self.stdout.write("\n🔍 VERIFICATION:")
        total_in_db = Tank.objects.count()
        self.stdout.write(f"   Total tanks in database: {total_in_db}")
        
        for category, _ in Tank.CATEGORY_CHOICES:
            count = Tank.objects.filter(category=category).count()
            self.stdout.write(f"   {category}: {count}")
        
        if stats['errors'] == 0:
            self.stdout.write(self.style.SUCCESS("\n🎉 Import completed successfully!"))
        else:
            self.stdout.write(self.style.WARNING(f"\n⚠️  Import completed with {stats['errors']} errors"))