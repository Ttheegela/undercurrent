// Weapon chain panel data for coverage.html (TRC-31, agent:b19). From b14 TRC-26 (build/detect/weapon_routes.json),
// with the independent fact-check corrections of 10:45: one exact-part ACE row only; all listing dates official.
// Maker-name routes (Texas Instruments, AD9361) are agency-only and deliberately not included.
window.WEAPON_CHAIN = {
  "status": "lead, not finding",
  "check": "independently checked (10:45)",
  "weapon": {"name": "Shahed-136 / Geran-2 drone", "part_role": "flight control unit"},
  "part": {
    "number": "STM32F765VIT6", "kind": "microcontroller", "maker": "STMicroelectronics",
    "gur_component": 2090, "gur_url": "https://war-sanctions.gur.gov.ua/en/components/2090",
    "gur_note": "GUR (Ukraine's defence intelligence) is a party to the war"
  },
  "part_to_weapon": {"proven": false, "label": "not proven: no record shows this chip in a weapon"},
  "shipments": [
    {"shipper": "ACE ELECTRONIC (HK) CO., LIMITED", "buyer": "OOO ONELEK", "date": "2022-08-26", "pieces": 100,
     "match": "exact part number in shipment text",
     "shipper_lists": ["BIS Entity List 2023-10-06", "OFAC 2024-10-30", "UK 2025-02-24", "EU 2025-07-18"],
     "source_file": "pulls/sayari/20260925T142701077807Z_19572_search_shipments.json"},
    {"shipper": "JINMINGSHENG TECHNOLOGY (HK) CO., LIMITED", "buyer": "OOO ONELEK", "date": "2022-11-30", "pieces": 22,
     "match": "exact part number in shipment text",
     "shipper_lists": ["OFAC 2024-05-01"],
     "source_file": "pulls/sayari/20260925T142701077807Z_19572_search_shipments.json"}
  ],
  "buyer": {"name": "OOO ONELEK", "country": "Russia", "lists": ["OFAC 2023-07-20"]},
  "notes": [
    "Both shipments happened before any of the three companies was listed.",
    "A part type found in a weapon does not prove these shipped chips reached one (parts may be resold, older, or counterfeit).",
    "Listing dates confirmed on official pages (fact-check 10:45)."
  ],
  "source_file": "build/detect/weapon_routes.json"
};
