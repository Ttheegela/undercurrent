// Ship tiles for coverage.html. Public-repo version: ships are named only because they are on official lists
// (UK and US). Owners and managers that are not on a US, UK, EU or UN list are described, not named.
// No ship positions exist in any of our sources: position is always null.
window.SHIPS = {
  "status": "lead, not finding",
  "position_note": "POSITION: NO DATA (no ship positions in our sources)",
  "ships": [
    {
      "name": "VELIKIY NOVGOROD", "imo": "9630004", "names_count": 2, "names": ["VELIKIY NOVGOROD", "VALERA"],
      "lists": ["UK RUS2246 (2024-10-17)", "US OFAC SDN"],
      "owner": "A Liberia-registered owning company: not on UK/US lists by name; reported as a subsidiary of Sovcomflot (OFAC SDN, UK), stake unknown",
      "manager": null,
      "flags_note": "5 countries on record (Oman, Comoros, Gabon, Cameroon, Russia), no dates",
      "position": null, "confidence": "checked",
      "source_file": "Sayari entity profile (sponsor data, not included)"
    },
    {
      "name": "SAMIRA", "imo": "9436006", "names_count": 5, "names": ["CAPE ANGLIA", "STEALTH CHIOS", "NEW TIMES", "SAMSUN", "SAMIRA"],
      "lists": ["UK RUS2807 (2025-07-21)", "US OFAC SDN"],
      "owner": null,
      "manager": "A Hong Kong ship manager: not on UK/US lists by name (other listings unconfirmed); manages 7 listed ships",
      "flags_note": "same 5-country set as the manager's other ships (Gambia, Comoros, Cameroon, Russia, Barbados), no dates",
      "position": null, "confidence": "checked",
      "source_file": "Sayari entity profile (sponsor data, not included)"
    }
  ],
  "managers": [
    {
      "name": "A Dubai ship manager (not named: not on UK/US lists by name)",
      "listed_ships": "16 UK-listed ships, 14 of them also on the US list",
      "manager_status": "manager not on UK/US lists; other listings reported by aggregators, unconfirmed",
      "position": null, "confidence": "medium",
      "source_file": "Sayari entity profile (sponsor data, not included)"
    }
  ]
};
