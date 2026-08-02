import os
import unittest

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from backend import main
from backend.navigation_links import normalize_navigation_payload


class NavigationLinkTests(unittest.TestCase):
    def test_single_google_link_creates_both_navigation_links(self):
        result = normalize_navigation_payload({
            "navigation_url": "https://www.google.com/maps?q=31.800123,34.650456",
        }, strict=True)

        self.assertEqual(result["coordinates"], "31.800123,34.650456")
        self.assertIn("waze.com/ul", result["waze_url"])
        self.assertIn("google.com/maps/dir", result["maps_url"])
        self.assertNotIn("navigation_url", result)

    def test_single_waze_link_creates_both_navigation_links(self):
        result = normalize_navigation_payload({
            "navigation_url": "https://waze.com/ul?ll=31.800123,34.650456&navigate=yes",
        }, strict=True)

        self.assertIn("waze.com/ul", result["waze_url"])
        self.assertIn("google.com/maps/dir", result["maps_url"])


class DuplicateLocationTests(unittest.TestCase):
    def setUp(self):
        self.db = main.SessionLocal()
        self.db.query(main.Location).delete()
        self.db.commit()
        self.db.add(main.Location(
            category="work_site",
            place_type="segment",
            name="קטע אשדוד - ניצנים",
            km="145+000",
            coordinates="31.800123,34.650456",
            waze_url="https://waze.com/ul?ll=31.800123,34.650456&navigate=yes",
            maps_url="https://www.google.com/maps/dir/?api=1&destination=31.800123%2C34.650456",
            notes="",
            created_by_id=1,
        ))
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_same_normalized_name_and_km_is_a_duplicate(self):
        candidate = main.LocationWriteIn(
            category="reporting_point",
            place_type="segment",
            name="קטע אשדוד ניצנים",
            km="145+000",
        )

        matches = main.find_location_duplicates(self.db, candidate)

        self.assertEqual(len(matches), 1)
        self.assertIn("אותו שם ואותו ק״מ רכבתי", matches[0]["reasons"])

    def test_same_destination_is_a_duplicate_across_link_providers(self):
        candidate = main.LocationWriteIn(
            category="reporting_point",
            place_type="station",
            name="שם אחר",
            km="146+000",
            coordinates="31.8001231,34.6504561",
        )

        matches = main.find_location_duplicates(self.db, candidate)

        self.assertEqual(len(matches), 1)
        self.assertIn("הקישור מוביל לאותה נקודה", matches[0]["reasons"])


if __name__ == "__main__":
    unittest.main()
