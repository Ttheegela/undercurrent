# Dual-use goods reaching Russia: what the records show

Trace the Unseen, Sanctions track, build day 25 September 2026.

**Documented conduct is stated plainly, with its source:** government findings (designations, indictments,
penalties) and countries' own trade statistics. Where something is our own inference, it is called a **lead**.
We describe conduct; we don't make legal findings. A part type found in a weapon does not prove that any
particular shipment reached one.

**About this version.** At the hackathon this story also used company-level shipment and registry records from a
commercial data vendor (Sayari). That data, and every count, date and claim derived from it, has been removed from
this site. What remains stands on official lists, government releases, countries' own trade statistics, published
studies and, where marked, the Tradeverifyd company-link tool.

**How to read the labels**

- **Solidity:** **H** (high: re-derived from saved files by an independent checker, dates on official pages),
  **M** (medium: counts checked, some dates from list files only), **L** (low: single source, estimate, or
  not re-checked).
- **Countries' own figures** are UN Comtrade declared export values (aggregate rows only), in US dollars.
- **Companies** are named only when they are on an official US, UK, EU or UN list, or named in an official
  government release. The list and date are given. Everyone else is described, not named.
- **Listing dates** come from official pages (OFAC recent actions, Federal Register, UK Sanctions List, EU
  Official Journal) unless marked "list-file date", which means OpenSanctions' "first seen" date: close to
  the official day but not confirmed on an official page.

Common official sources: OFAC recent actions `https://ofac.treasury.gov/recent-actions/YYYYMMDD`, US Treasury
press releases `https://home.treasury.gov/news/press-releases/<id>`, the Federal Register
(`https://www.federalregister.gov`), the UK Sanctions List
(`https://www.gov.uk/government/publications/the-uk-sanctions-list`), EU law (`https://eur-lex.europa.eu`),
UN Comtrade (`https://comtradeplus.un.org`).

---

## 1. New doors opened after the invasion

Chips (customs code HS 8542, "electronic integrated circuits") kept reaching Russia after February 2022.

- **The middle countries' own figures.** Countries' own reported chip exports to Russia (UN Comtrade,
  corrected aggregate rows):
  - Kyrgyzstan: about $0 (2019 to 2021), $0.66M (2022), $13.5M (2023), $1.3M (2024), $2.0M (2025)
  - Kazakhstan: $0.2M to $0.3M before, $18.3M (2022), $15.6M (2023), $0.4M (2024)
  - Armenia: about $0 before, $13.1M (2022), $15.7M (2023)

  **H.** Earlier totals of $27.1M, $36.5M and $52.4M were double-counted and have been withdrawn.
- **Companies in these countries on US lists.**
  - ELEM GROUP (Almaty, Kazakhstan): BIS Entity List 2023-12-07 (Federal Register 88 FR 85097), then OFAC
    2024-02-23. STRELOI EKOMMERTS (St Petersburg): OFAC 2023-12-12. Neither is on the UK list. Note: the
    Entity List entry "Streloy" (2023-09-27) is a different, older company, LLC STRELOI (OFAC 2023-09-14). **H**
  - ITIC LLC FZ (Dubai): OFAC 2024-06-12, EU 2025-02-25. MDIKAM-EK: OFAC 2023-11-02. **H**
  - RM Design and Development (Bishkek): OFAC 2023-07-20 (Federal Register 2023-16934, published
    2023-08-08). OFAC's own entry says "Established 17 Mar 2022", 21 days after the invasion. **H**
- **Published research.** KSE Institute (Kyiv School of Economics) found China 53.2% and Hong Kong 22.7% of
  Russia's battlefield-goods imports by value, Jan to Oct 2023. **H** for KSE's figures (cited).

## 2. Lists catch up months later

- **One official example.** RM Design and Development: established 2022-03-17 according to OFAC's own entry,
  listed by OFAC on 2023-07-20, so **at least 16 months** from founding to listing. **H**
- **Pattern at scale.** On the US list, 240 pairs of Russia-programme organisations share a normalised address
  but were listed in different waves; median gap 167 days. Uses list-file dates. **M-H**
- **Export bans.** A BIS temporary denial order of 2025-02-06 covered a ring through Turkey, Uzbekistan and the
  UAE (Apelsin Logistics, FC Marakanda 7777, Element Uluslararasi Nakliyat, Astec Astronomy FZCO, per BIS's
  FY2025 annual report). **H**
- **Lists also forget.** Megasan Elektronik (Turkey; OFAC 2023-12-12, Treasury jy1978) appears on a Treasury
  "Russia-related Designations Removals" page of 2026-06-29 and is missing from the current US sanctions list
  file, but stays on the BIS Entity List (2024-02-23, 89 FR 14388). **M** (removal notice itself not read).
- **The US has almost stopped adding.** Of 548 companies and ships added to the US Russia list since 2025,
  523 were added on 2025-01-10 and 2025-01-15 and 25 on 2025-10-22 (oil majors and units). The EU and UK keep
  adding: EU packages on 2026-04-23 (act 2026/509, 116 entries) and 2026-07-23 (211 entries). **H** for the
  pattern, **M** for counts (list-file dates).

## 3. Buyers and suppliers named by governments

- **Testkomplekt** (OFAC 2023-05-19, UK 2023-08-08, also EU-listed). Treasury press release jy2700 names
  Testkomplekt as a customer of Shenzhen One World, Shenzhen A Technology and Innovio Ventures. Their listings:
  Shenzhen One World and Innovio Ventures (BIS Entity List 2023-10-06), Shenzhen A Technology (OFAC 2024-10-30).
  **H**
- **Other listed buyers and sellers in our research:** OOO Enkor Grupp (Kaliningrad; OFAC 2023-09-14, Federal
  Register 2023-21224, Treasury jy1731), OOO Titan-Micro (OFAC 2023-05-19, Treasury jy1494), Sinno Electronics
  (Hong Kong; BIS Entity List effective 2022-06-28, OFAC 2022-09-30, UK 2023-12-06). **H**
- **Looking down from the chip makers finds nothing; looking up from the buyer does.** In Tradeverifyd, three
  big chip makers' records link only to their own packaging plants and partners, with no link into the route
  countries. Starting from Testkomplekt instead turned up 7 listed suppliers in one look-up. **H** for "no
  route-country link visible", **M** for what it means (Tradeverifyd links carry no dates or volumes).

## 4. Part numbers: from a weapon to a supplier

- **The drone chip.** Ukraine's defence intelligence (GUR, a party to the war) lists the STMicroelectronics
  STM32F765VIT6 microcontroller in the Shahed-136 drone (component 2090:
  `https://war-sanctions.gur.gov.ua/en/components/2090`). **H** for what GUR publishes. **Not proven:** that
  any particular shipment of this part reached a weapon (parts are resold, and counterfeits exist).
- **Context, cited not re-checked.** RUSI (a UK defence think tank) found 450+ foreign parts in 27 Russian
  weapons (2022) and linked Sinno-exported parts to an Orlan-10 drone. **L** (not re-checked by us).

## 5. Turkey

- **Listed firms.** BRK Uluslararasi Nakliyat (BIS Entity List 2024-08-27, OFAC 2024-10-30); Treasury says it
  exported high-priority items to Russia. Also on US lists: Smart Trading (OFAC 2023-04-12, UK 2023-12-06),
  Azint (OFAC 2023-11-02, Treasury jy1871), Megasan (OFAC 2023-12-12; later removed, see section 2), Yildiz Cip
  (EU Annex IV Feb 2024; BIS Entity List 2024-11-01), LSS Global and Marten EA (OFAC 2024-05-01), BP Dis
  Ticaret and Suvari (OFAC 2024-10-30). **H**
- **Turkey's own figures.** Chip exports to Russia: $0.06M (2021), $2.8M (2022), $3.8M (2023), $4.8M
  (2024), $3.5M (2025). **H**
- **Bank pressure after Executive Order 14114 (2023-12-22):** Turkey's total exports to Russia fell 28% in
  H1 2024 (Turkey's own monthly figures), but Turkey's own chip exports to Russia rose in 2024. We cannot
  confirm a drop in chip flows. **L** to **M**.

## 6. United Arab Emirates

- **Listed firms.** Hulm Al Sahra (OFAC 2023-04-12, Treasury jy1402), Bliksem Computers and Mobitronix (OFAC
  2023-11-02), Aspect DWC (OFAC 2023-12-12), Asia International Trade Provider (list-file date 2024-02-23),
  ITIC LLC FZ (OFAC 2024-06-12), Asia Material Solutions (a Hong Kong company; OFAC 2024-08-23). **H**
- **UAE's own figures.** Chip exports to Russia: $1.28M (2019), $1.68M (2021), $4.76M (2022), $2.13M (2023);
  no 2024 report. So this door was open before 2022, unlike Kyrgyzstan's. **H**

## 7. Hong Kong and mainland China: the bulk of the flow

- **Countries' own figures** (chip exports to Russia, $M, 2021 to 2025): China 72, 180, 178, 100, 62; Hong
  Kong 283, 208, 308, 172, 190. **H**
- **Listed examples.** Analog Technology Ltd (OFAC 2024-06-12), Hongkong Chip Line (OFAC 2024-08-23), 3-K
  Electronics (BIS Entity List 2024-08-27), Suntop Semiconductor (BIS Entity List 2023-10-06, 88 FR 70352).
  **M** (some list-file dates).
- **Bank pressure moved timing, not need.** China's total exports to Russia fell 16.1% in March 2024 and
  13.3% in April (China's own monthly figures, matching Carnegie's published numbers), then recovered by June.
  Chip exports did not recover: H2 2024 $34.6M vs $113.5M in H2 2023 (down 70%). **H**

## 8. Machine tools and bearings

- **Countries' own exports to Russia, 2021 to 2023.** Machine tools (HS 8457 to 8465): China $418M to
  $1,475M; Turkey $54M to $216M; Kazakhstan $1.3M to $48.2M; India $4.5M to $46.5M (and $111M in 2025).
  Germany fell from $261M to $1.8M (2024), Taiwan $112M to $9.7M (2024), Japan $30M to $0.6M. Bearings
  (HS 8482): China $41.5M to $206.7M; Turkey $3.6M to $44.7M; Kazakhstan $57.1M to $143.2M (2024); Germany
  $99.6M to about zero. **H** (2024 to 2025 zeros may be missing reports).
- **Listed bearing and parts traders.** Egetir Otomotiv and Bosfor Avrasya (Turkey; OFAC, named in Treasury
  jy1978 of 2023-12-12; UK 2024-06-13). MOTO EXPORT DWC LLC and AUTO PARTS EAST FZCO (UAE; OFAC 2024-10-30).
  **H**
- **Official action.** In April 2026 the EU used its anti-circumvention tool for the first time, banning
  exports of CNC machines and radios to Kyrgyzstan (20th package). **H**

## 9. Climate commodities: plywood and aluminium

- **Plywood through Kazakhstan.** The EU banned Russian wood on 8 April 2022 (Regulation (EU) 2022/576).
  Kazakhstan's plywood exports went $0.45M (2021), $30.0M (2022), $83.0M (2023), $40.8M (2024). In 2023 it
  exported 95.0M kg and imported 85.8M kg, 59.2M kg of that from Russia: about as much out as in. Twelve EU
  countries reported plywood imports from Kazakhstan of $0 (2019 to 2021), $21.6M, $84.7M (2023), $39.6M;
  Poland alone took $65.8M in 2023. Russian plywood arriving directly fell from $608.8M (2021) to $2.0M (2023).
  **H**
- **Official confirmation.** On 2024-05-14 the European Commission extended anti-dumping duties on Russian
  birch plywood to goods sent from Kazakhstan and Turkey, finding they moved through or were finished there.
  2024 flows from both then dropped. About two years from ban to fix. **H**
- **Aluminium.** Russia's largest aluminium producer is not on the US, UK or EU lists in our files. Buying
  Russian aluminium was legal in Turkey and, for most of this period, in the EU. **H**
- **Rules cover origin, not content.** Since 2024-04-13 the US bans imports of Russian-origin aluminium,
  copper and nickel (Treasury jy2249). Whether goods made in a third country from Russian metal count: not
  verified. **H** for the rule.
- **Parent clean, subsidiaries listed.** Ten Norilsk-based firms were added to the US list on 2024-08-23
  (Treasury jy2546); the parent of Russia's main nickel miner is not on the lists in our files. **H**
- **No sign of relabelling in aluminium from Kazakhstan** (it has its own smelter; its Russian aluminium
  imports fell from $71.9M to $1.5M) **or in fertiliser** (Russian fertiliser stayed legal in the EU). **M**
- **Climate stakes (context, cited).** In July 2026, 150 of 268 tankers carrying Russian seaborne oil were
  "shadow fleet" ships, 93% of them over 15 years old (KSE Institute tracker). Oil and gas are planned at about
  22% of Russia's 2026 federal budget revenue (Finance Ministry plan as reported). **M**

## 10. Payments: new channels open in weeks

- **A bank as a channel.** OJSC Keremet Bank (Kyrgyzstan): OFAC 2025-01-15 under E.O. 14114; Treasury says it
  moved money for the listed Russian defence bank Promsvyazbank (PSB). **H**
- **Crypto and a quick rename.** After the Garantex exchange takedown on 2025-03-06, customers moved to Grinex,
  and a ruble token (A7A5) from Kyrgyz firm Old Vector was used (Treasury sb0225). Grinex, A7, A7 Agent, A71
  and Old Vector: OFAC list-file date 2025-08-14. EU followed: Grinex 2025-10-23, A7 Agent and A71 2026-07-23,
  about 11 months later. **M-H**
- **Pressure on banks** (see section 7) cut China's exports for about three months and chips for longer.

## 11. Screening gaps

- **Our own checker has blind spots.** It reads asset-freeze lists only, so it misses every EU Annex IV
  (export-restriction) firm, such as Shisan (EU Annex IV entry 964, 2026-07-24) and Rama Group's EU entry
  (Annex IV entry 963; Rama Group is also UK-listed, 2025-02-24). It missed "Compel" for Kompel, "Intellect"
  for Intellekt, and the four-letter name GTME (OFAC 2023-07-20 as ZAO GTME Tekhnologii). Export denial lists
  (Denied Persons List, Entity List) also need checking, not only asset-freeze lists. **H**
- **False alarms happen.** A Tradeverifyd record for a major US chip designer carries 12 flags that belong to a
  neighbouring Iran network; none of our lists names the designer. **H**

## 12. AI chips

- **Rules, with dates (official).** US advanced-chip controls 2022-10-07 and 2023-10-25 (88 FR 73458); AI
  Diffusion rule 2025-01-15, rescinded 2025-05-13; H200 and MI325X moved to case-by-case review 2026-01-15.
  Renting chips remotely in the cloud is not controlled. **H**
- **Chinese AI and chip firms on the BIS Entity List:** Sugon 2019-06-24, SMIC 2020-12-18, Cambricon
  2022-12-16, Inspur Group 2023-03-06, Biren and Moore Threads 2023-10-17, Zhipu and Sophgo (including its
  Singapore unit) 2025-01-16, Beijing Academy of Artificial Intelligence 2025-03-25. **H**
- **Reported shipments to Russia.** Bloomberg reported that Shreya Life Sciences (India) shipped servers with
  H100 chips to Russia; OFAC listed Shreya on 2024-10-30, two days after the report. Other listed firms in our
  research: Tornetcom (OFAC 2024-10-30), Innovio Ventures (BIS Entity List 2023-10-06, then OFAC), Guangzhou
  Chiphome (OFAC 2024-08-23), CTL Dis Ticaret (OFAC 2023-09-14; Entity List 2024-02-23). **M** (the reported
  shipments are Bloomberg's, not re-checked by us).
- **Official cases show the scale.** In March 2026 the US Justice Department charged three people over about
  $2.5B of servers bought in 2024 to 2025 by an unnamed Southeast Asian company and moved on to China; dummy
  servers were staged to pass an audit. A separate criminal complaint describes at least 21 GPU shipments to
  forwarders in Singapore and Malaysia paid from Hong Kong and China. The think tank CNAS estimates a median of
  about 140,000 AI chips smuggled to China in 2024 (a model, not a count). **H** for what the documents say;
  charges are allegations until proven.

---

## Corrections applied

Everything below was caught by an independent checker on the day and is already reflected above.

- ELEM GROUP's first restriction is the BIS Entity List, 2023-12-07 (88 FR 85097), not OFAC 2024-02-23. The
  Entity List "Streloy" entry is LLC STRELOI (a 2013 company), not STRELOI EKOMMERTS.
- ITIC LLC FZ is sanctioned (OFAC 2024-06-12, EU 2025-02-25).
- Comtrade totals were double-counted; only aggregate rows are used ($13.5M, $18.3M, $13.1M, not $27.1M,
  $36.5M, $52.4M).
- Sinno's OFAC date is 2022-09-30 (2023-04-20 is a dataset start date, not a listing date); its Entity List
  date is 2022-06-28 (effective), printed 2022-06-30. RM Design's OFAC date is 2023-07-20 (the Federal
  Register notice was published 2023-08-08).
- GTME is listed. Rama Group's EU entry is Annex IV (export restriction), not an asset freeze.
- Hulm Al Sahra's OFAC date is 2023-04-12, and its Entity List date is not used. Asia Material Solutions is a
  Hong Kong company.
- The "about 30% of Russia's budget from oil and gas" figure is replaced by about 22% (2026 plan).
