import csv
from django.core.management.base import BaseCommand
from calculator.models import Tank, TankCapacity
from pathlib import Path


class Command(BaseCommand):
    help = "Import tank data from CSV (RCT / SST / FM)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--type",
            type=str,
            required=True,
            help="Tank type: RCT / SST / FM"
        )
        parser.add_argument(
            "--file",
            type=str,
            required=True,
            help="CSV file path"
        )

    def handle(self, *args, **options):
        tank_type = options["type"].upper()
        file_path = Path(options["file"])

        if not file_path.exists():
            self.stdout.write(self.style.ERROR("CSV file not found"))
            return

        created_tanks = 0
        created_caps = 0

        with open(file_path, newline="", encoding="utf-8") as csvfile:
            reader = csv.DictReader(csvfile)

            for row in reader:
                model = row["model"].strip()
                diameter = float(row["diameter"])
                height = float(row["height"])

                # support both capacity / capacity_m3
                capacity_value = (
                    row.get("capacity")
                    or row.get("capacity_m3")
                )

                capacity = float(capacity_value)

                tank, tank_created = Tank.objects.get_or_create(
                    tank_type=tank_type,
                    model=model,
                    defaults={"diameter": diameter}
                )

                if tank_created:
                    created_tanks += 1

                _, cap_created = TankCapacity.objects.get_or_create(
                    tank=tank,
                    height=height,
                    defaults={"capacity": capacity}
                )

                if cap_created:
                    created_caps += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Import completed → Tanks: {created_tanks}, Capacities: {created_caps}"
            )
        )
