// Ship tiles for coverage.html. Public-repo version: ships are named only because they are on official lists
// (UK, US and EU). Names and list entries come from those lists only.
// No ship positions exist in any of our sources: position is always null.
window.SHIPS = {
  "status": "lead, not finding",
  "position_note": "POSITION: NO DATA (no ship positions in our sources)",
  "ships": [
    {
      "name": "VELIKIY NOVGOROD", "imo": "9630004", "names_count": 2, "names": ["VELIKIY NOVGOROD", "VALERA"],
      "lists": ["UK RUS2246 (2024-10-17)", "US OFAC SDN"],
      "position": null, "confidence": "checked",
      "source": "UK sanctions list; US OFAC list; EU ship list"
    },
    {
      "name": "SAMIRA", "imo": "9436006", "names_count": 2, "names": ["SAMIRA", "SAMSUN"],
      "lists": ["UK RUS2807 (2025-07-21)", "US OFAC SDN"],
      "position": null, "confidence": "checked",
      "source": "UK sanctions list; US OFAC list"
    }
  ]
};
