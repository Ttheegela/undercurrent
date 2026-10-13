# Dual-use goods reaching Russia: what the records show

Trace the Unseen, Sanctions track, build day 25 September 2026.

**Documented conduct is stated plainly, with its source:** government findings (designations, indictments,
penalties) and what the records directly show, such as a company that kept shipping to Russia after it was
sanctioned. Where something is our own inference (timing, a shared address, a firm that is not listed), it is
called a **lead**. We describe conduct; we don't make legal findings. A part type found in a weapon does not
prove that any particular shipment reached one.

**How to read the labels**

- **Solidity:** **H** (high: re-derived from saved files by an independent checker, dates on official pages),
  **M** (medium: counts checked, some dates from list files only), **L** (low: single source, estimate, or
  not re-checked).
- **Record counts** are shipment records in Sayari's trade data (mostly Russia's own customs declarations).
  They are not values, not weights, and not proof of physical routes. "Departure country" is what the record
  declares.
- **Countries' own figures** are UN Comtrade declared export values (aggregate rows only), in US dollars.
- **Companies** are named only when they are on an official US, UK, EU or UN list, or named in an official
  government release. The list and date are given. Everyone else is described, not named.
- **Listing dates** come from official pages (OFAC recent actions, Federal Register, UK Sanctions List, EU
  Official Journal) unless marked "list-file date", which means OpenSanctions' "first seen" date: close to
  the official day but not confirmed on an official page.
- **Data thins out after late 2023.** About 81% of chip records into Russia come from Russia's own customs
  data, which appears to end around then. A route or firm "stopping" in late 2023 may be the data stopping.

Common official sources: OFAC recent actions `https://ofac.treasury.gov/recent-actions/YYYYMMDD`, US Treasury
press releases `https://home.treasury.gov/news/press-releases/<id>`, the Federal Register
(`https://www.federalregister.gov`), the UK Sanctions List
(`https://www.gov.uk/government/publications/the-uk-sanctions-list`), EU law (`https://eur-lex.europa.eu`),
UN Comtrade (`https://comtradeplus.un.org`).

---

## 1. New routes opened right after the invasion

Chips (customs code HS 8542, "electronic integrated circuits") kept reaching Russia after February 2022, but
through new doors.

- **Size.** 582,920 chip shipment records into Russia, 2018 to 2026. Largest departure countries: China
  276,076, Hong Kong 142,776, Turkey 21,537. (Sayari shipment records.) **M-H**
- **New routes, with start dates.** Kyrgyzstan 1,147 records from 2022-04-21; United Arab Emirates 2,041 from
  2022-04-05; Kazakhstan 715 from 2022-05-22. Germany and Turkey go back to 2019. (Sayari shipment records.)
  **M-H**
- **A second, independent source agrees.** Countries' own reported chip exports to Russia (UN Comtrade,
  corrected aggregate rows):
  - Kyrgyzstan: about $0 (2019 to 2021), $0.66M (2022), $13.5M (2023), $1.3M (2024), $2.0M (2025)
  - Kazakhstan: $0.2M to $0.3M before, $18.3M (2022), $15.6M (2023), $0.4M (2024)
  - Armenia: about $0 before, $13.1M (2022), $15.7M (2023)

  **H.** Earlier totals of $27.1M, $36.5M and $52.4M were double-counted and have been withdrawn.
- **The chips were not made there.** On the Kyrgyz route only 45 of 1,147 records say "made in Kyrgyzstan";
  most say China, Malaysia or Taiwan. **M** (the origin field is sometimes a default).
- **Both ends of the new routes are listed.**
  - Kazakhstan route: 93% of records run between ELEM GROUP (Almaty) and STRELOI EKOMMERTS (St Petersburg).
    ELEM GROUP: BIS Entity List 2023-12-07 (Federal Register 88 FR 85097), then OFAC 2024-02-23. STRELOI
    EKOMMERTS: OFAC 2023-12-12. Neither is on the UK list. Note: the Entity List entry "Streloy"
    (2023-09-27) is a different, older company, LLC STRELOI (OFAC 2023-09-14), at the same street address.
    **H**
  - UAE route: top shipper ITIC LLC FZ (Dubai): OFAC 2024-06-12, EU 2025-02-25. Top buyer MDIKAM-EK: OFAC
    2023-11-02. **H**
  - Kyrgyz route: top shipper RM Design and Development (Bishkek): OFAC 2023-07-20 (Federal Register
    2023-16934, published 2023-08-08). **H**
- **Matches published research.** KSE Institute (Kyiv School of Economics) found China 53.2% and Hong Kong
  22.7% of Russia's battlefield-goods imports by value, Jan to Oct 2023. Our shares by record count: China
  47.4%, Hong Kong 24.5%. Both likely draw on Russian customs data, so this is agreement, not fully
  independent proof. **H** for the shares.

## 2. Company churn: names change in weeks

- **Firms born just after the invasion.** ELEM GROUP was registered 2022-03-14, 18 days after the invasion.
  RM Design and Development was registered 2022-03-17; OFAC's own entry says "Established 17 Mar 2022". Both
  are OFAC-listed. They sent 2,059 and 4,733 shipment records. **H**
- **More names, same flow (Kyrgyz route).** Firms per half-year went 1, 4, 12, 6 while shipments continued
  (186, 279, 569, 113). The median firm was active 40 days; 6 of 14 appear on a single day. **H**
- **A relay (Kazakhstan route).** One firm at a time, each replaced whole. ELEM GROUP carried 93% of the route
  in 118 days; unlisted firms carried it before and after. **H**
- **Firms run several doors at once.** Rama Group (UK list 2025-02-24; EU export-restriction list, Annex IV,
  entry 963) shipped from Kyrgyzstan (239 records), Thailand (1,405) and Hong Kong (576). Shisan (EU Annex IV,
  entry 964, Council Decision (CFSP) 2026/1849, 2026-07-24) shipped from Kyrgyzstan (176) and Thailand (693).
  Both dropped the Kyrgyz leg but kept shipping from Thailand and Hong Kong into 2024. Their shared buyers,
  Katrade and Sol Group, are OFAC-listed (2024-08-23). **H**
- **Hong Kong looks similar at 100 times the scale.** In a sample of Hong Kong shipments of three US and
  European chip brands (44 firms), firms per half-year rose 5, 10, 14, 25 while shipments stayed flat. But
  a brand-by-brand sample makes firms look shorter-lived than they are: four "one-day" firms were really
  active 32 to over 259 days. **M** for the count, **L** for lifespans.

## 3. Listing lag: lists catch up months later

- **Time from first sign to first listing (all "at least", dates official):**
  - ELEM GROUP: registered 2022-03-14, first restricted 2023-12-07 (BIS Entity List): **at least 20 months**
  - STRELOI EKOMMERTS: first shipment 2022-06-12, OFAC 2023-12-12: at least 18 months
  - RM Design and Development: registered 2022-03-17, OFAC 2023-07-20: at least 16 months
  - ITIC LLC FZ: first record 2023-03-06, OFAC 2024-06-12: at least 15 months

  **Range: 15 to 20 months. H.** (Corrected at 13:12: the earlier 23-month figure for ELEM GROUP used its
  later OFAC date.)
- **Most had already left the route.** 4 of 5 listed shippers on the new routes had stopped on that route
  before listing: RM Design 24 days before; ELEM GROUP about 7 months before its first listing; Rama Group's
  Kyrgyz leg 525 days before (the firm itself kept shipping elsewhere). **H**
- **Trade after listing (minimum counts from saved records):**
  - Xinjiang Daqo New Energy (BIS Entity List 2021-06-24) sent 99.99% silicon to OOO Enkor Grupp
    (Kaliningrad): 7 shipments 2023-08-02 to 2025-01-21; 2 before and 5 after Enkor's OFAC listing on
    2023-09-14 (Federal Register 2023-21224; Treasury jy1731). Tax number matches. **M-H**
  - Sinno Electronics (Hong Kong; BIS Entity List effective 2022-06-28, OFAC 2022-09-30, UK 2023-12-06) to
    OOO Titan-Micro (OFAC 2023-05-19, Treasury jy1494): 24 records Sept to Dec 2023, all after both US
    listings. Sinno overall: at least 50 records after its Entity List date, 34 after OFAC. **M-H**
  - Testkomplekt (OFAC 2023-05-19, UK 2023-08-08) kept receiving for 22 months after its own listing; at
    least 70 records after OFAC. **H**
  - RM Design and Development: 40 of 76 records on its Turkey-to-Russia leg are dated after its 2023-07-20
    listing (running to 2023-09-29). **H**
- **Export bans lag too.** A BIS temporary denial order of 2025-02-06 covered a ring through Turkey,
  Uzbekistan and the UAE (Apelsin Logistics, FC Marakanda 7777, Element Uluslararasi Nakliyat, Astec Astronomy
  FZCO, per BIS's FY2025 annual report). Sponsor records show at least 36 rows for the Uzbek firm into or out
  of Russia after the order (name match only). A 2023-05-16 order covering a Maldives relay was followed by at
  least 34 Maldives-to-Russia rows. **M**
- **Pattern at scale.** On the US list, 240 pairs of Russia-programme organisations share a normalised address
  but were listed in different waves; median gap 167 days. Uses list-file dates. **M-H**
- **Lists also forget.** Megasan Elektronik (Turkey; OFAC 2023-12-12, Treasury jy1978) appears on a Treasury
  "Russia-related Designations Removals" page of 2026-06-29 and is missing from the current US sanctions list
  file, but stays on the BIS Entity List (2024-02-23, 89 FR 14388). Its last chip record into Russia fell on
  its OFAC listing day. **M** (removal notice itself not read).
- **The US has almost stopped adding.** Of 548 companies and ships added to the US Russia list since 2025,
  523 were added on 2025-01-10 and 2025-01-15 and 25 on 2025-10-22 (oil majors and units). The EU and UK keep
  adding: EU packages on 2026-04-23 (act 2026/509, 116 entries) and 2026-07-23 (211 entries). **H** for the
  pattern, **M** for counts (list-file dates).

## 4. Buyers persist: the steady thing to watch

- **Testkomplekt** (OFAC 2023-05-19, UK 2023-08-08, also EU-listed): one record 2019 to 2025, 9,141 rows.
  Western distributors stop by 2022-03-02. Then six suppliers in Hong Kong, Shenzhen and India appear, all
  later US-listed 3 to 17 months after first appearing: Shenzhen One World and Innovio Ventures (BIS Entity
  List 2023-10-06), Flavic FZE (OFAC, list-file date 2023-11-02), Robotronix Semiconductors (OFAC, list-file
  date 2023-12-12), Shenzhen A Technology and Group Yeoh (OFAC 2024-10-30). Treasury press release jy2700
  names Testkomplekt as a customer of One World, Shenzhen A Technology and Innovio. Flavic FZE sent one record
  on 2024-01-04, after both were listed. **H**
- **Top 10 Russian chip buyers.** 6 of 10 were already buying in 2019 to 2020 and kept buying into late 2023
  or 2024; 4 appeared in 2022. So buyers renew too, just more slowly. Listed ones include JSC Kompel (OFAC
  2023-07-20, UK 2024-02-22, EU 2024-06-24), Spetsvoltazh and Kvazar (OFAC 2023-05-19), Onelek, Altrabeta and
  Staut (OFAC 2023-07-20), Intellekt Telekom (OFAC 2024-10-30). Kvazar kept receiving chips 14 months after
  its listing. The largest buyer is flagged by the sponsor as EU-restricted, but it is not on the EU, US or UK
  asset-freeze lists we checked, so it is not named. **M-H**
- **Hub suppliers serve several buyers.** YW NL E-Commerce (UK 2025-10-15) supplies three of the top 10
  buyers. Elmec Trade (OFAC 2023-05-19), Asialink Shanghai (OFAC 2024-06-12) and Thamestone (OFAC 2023-12-12)
  each supply two. Screening one hub supplier touches several buyers at once. **M-H**
- **LLC Spetselservis** (OFAC 2023-07-20) received chips from 10 Hong Kong and China shippers, Jan 2022 to
  Oct 2023, including 6 after its own listing; at least 6 of those shippers were listed later. **M**
- **Looking down from the chip makers finds nothing; looking up from the buyer does.** In Tradeverifyd, three
  big chip makers' records link only to their own packaging plants and partners, with no link into the route
  countries. Starting from Testkomplekt instead turned up 7 listed suppliers in one look-up. **H** for "no
  route-country link visible", **M** for what it means (Tradeverifyd links carry no dates or volumes).

## 5. Part numbers: from a weapon to a shipment

- **The drone chip.** Ukraine's defence intelligence (GUR, a party to the war) lists the STMicroelectronics
  STM32F765VIT6 microcontroller in the Shahed-136 drone (component 2090:
  `https://war-sanctions.gur.gov.ua/en/components/2090`). Sponsor records show the exact part number in two
  shipments into Russia:
  - ACE ELECTRONIC (HK) to OOO Onelek, 2022-08-26, 100 pieces
  - JINMINGSHENG TECHNOLOGY (HK) to Onelek, 2022-11-30, 22 pieces

  All three were listed later: ACE BIS Entity List 2023-10-06, OFAC 2024-10-30, UK 2025-02-24, EU
  2025-07-18; Jinmingsheng OFAC 2024-05-01; Onelek OFAC 2023-07-20. **H** for the chain of records. **Not
  proven:** no record shows these chips in a weapon (parts are resold, and counterfeits exist).
- **You need the full ordering code.** Searching "STM32F765" returned 0 rows; "STM32F765VIT6" returned 3.
  **H**
- **Same parts, new sellers.** Xilinx chips into Russia: 181 records, 58 shipper names, 45 of them seen in one
  month only. Before the invasion the chips came from Germany and the Netherlands; after, from China, Hong
  Kong, India and Thailand. Only 2 of 39 post-invasion shippers had shipped before. 20 of 67 post-invasion
  Xilinx or Altera shippers are exactly on a US list. **H**
- **Aircraft and drone parts (HS 8807).** India sent 3,948 of 5,013 records into Russia. **M**
- **Context, cited not re-checked.** RUSI (a UK defence think tank) found 450+ foreign parts in 27 Russian
  weapons (2022) and linked Sinno-exported parts to an Orlan-10 drone. **L** (not re-checked by us).

## 6. Turkey: a hub concentrated in a few firms

- **21,537 chip records** from Turkey into Russia, 2019-10-08 to 2024-07-26. Only 988 (4.6%) say Turkish-made;
  most say Malaysia, China, Taiwan, Thailand or the Philippines. **H**
- **Concentrated.** One logistics firm, BRK Uluslararasi Nakliyat (BIS Entity List 2024-08-27, OFAC
  2024-10-30), carries about 45% (9,782). Treasury says it exported high-priority items to Russia. One Russian
  buyer receives 61% (13,208); the sponsor flags it EU-restricted, which we could not confirm, so it is not
  named. **H**
- **9 of the top 10 shipper firms are on US lists**, listed 2 to 31 months after first shipping. Examples:
  Smart Trading (OFAC 2023-04-12, UK 2023-12-06), Azint (OFAC 2023-11-02, Treasury jy1871), Megasan (OFAC
  2023-12-12; later removed, see section 3), Yildiz Cip (EU Annex IV Feb 2024; BIS Entity List 2024-11-01),
  LSS Global and Marten EA (OFAC 2024-05-01), BP Dis Ticaret and Suvari (OFAC 2024-10-30). **H**
- **Turkey's own figures.** Chip exports to Russia: $0.06M (2021), $2.8M (2022), $3.8M (2023), $4.8M
  (2024), $3.5M (2025). **H**
- **RM Design's Turkey leg.** 76 records from 2022-08-16 to 2023-09-29; the declared shipper is always the
  Kyrgyz firm, and 56 give an Istanbul address. A batch of 24 arrived on 2023-07-17, three days before the
  OFAC listing; the Kyrgyz route's last record was 2023-06-26. 40 of 76 are dated after listing. Goods: chips
  (including Taiwan-made processors), network switches, rugged computers, power supplies. Buyers: Basis Trade
  Prosoft 49 and Region-Prof 17 (both OFAC 2023-07-20), S 7 Engineering 9 (OFAC 2024-02-23). OFAC's release
  (Treasury jy1636) never mentions Turkey. The move to Turkey began before the listing, not because of it.
  **H** (dates are Russian arrival dates).
- **An address is not a signal on its own.** The Istanbul business tower used by RM Design houses 194 firms.
  **H** for the count.
- **Bank pressure after Executive Order 14114 (2023-12-22):** Turkey's total exports to Russia fell 28% in
  H1 2024 (Turkey's own monthly figures), but Turkey's own chip exports to Russia rose in 2024. We cannot
  confirm a drop in chip flows. **L** to **M**.

## 7. United Arab Emirates: dedicated pipes, dirtier than Turkey

- **2,041 chip records** from the UAE into Russia, 2022-04-05 to 2023-12-30. At most 169 (8.3%) say
  UAE-made; 1,043 say China. **H** for counts, **L** for the made-in share.
- **Top shipper ITIC LLC FZ has 800 records (39%); top buyer MDIKAM-EK has 919 (45%).** The top 3 shippers
  have 68%. Unlike Turkey there is no freight forwarder in the middle. **H**
- **7 of the top 10 shippers are OFAC-listed**, 1,707 of 2,041 records together (84%). First shipment to
  listing: Hulm Al Sahra (OFAC 2023-04-12, Treasury jy1402; about 12 months), Bliksem Computers and
  Mobitronix (OFAC 2023-11-02; about 12 and 9 months), Aspect DWC (OFAC 2023-12-12; 5 months), Asia
  International Trade Provider (list-file date 2024-02-23; 14 months), ITIC (OFAC 2024-06-12; 15 months), Asia
  Material Solutions (a Hong Kong company shipping from the UAE; OFAC 2024-08-23; 14 months). **H** for
  listings; use route counts only (searching by name inflates counts).
- **The sponsor's "sanctioned" flag missed 6 of these 7** (1,388 records). **H**
- **UAE's own figures.** Chip exports to Russia: $1.28M (2019), $1.68M (2021), $4.76M (2022), $2.13M (2023);
  no 2024 report. So this door was open before 2022, unlike Kyrgyzstan's. **H**

## 8. Hong Kong and mainland China: the bulk of the flow

- **Many more firms.** Sayari lists 1,356 shipper records sending chips from Hong Kong to Russia and 4,395
  from China (Kyrgyzstan: about 14). **M-H**
- **Countries' own figures** (chip exports to Russia, $M, 2021 to 2025): China 72, 180, 178, 100, 62; Hong
  Kong 283, 208, 308, 172, 190. **H**
- **Now listed, about 11 months or more after first appearing.** 17 of 44 sampled Hong Kong firms and 13 of 56
  China-route firms match a list entry. Examples: Analog Technology Ltd (OFAC 2024-06-12), Hongkong Chip Line
  (OFAC 2024-08-23), 3-K Electronics (BIS Entity List 2024-08-27). **M** (lags are floors; list-file dates).
- **Shipped after an export listing.** Suntop Semiconductor shipped on 2023-12-22, after its BIS Entity List
  date of 2023-10-06 (88 FR 70352). **M**
- **Bank pressure moved timing, not need.** China's total exports to Russia fell 16.1% in March 2024 and
  13.3% in April (China's own monthly figures, matching Carnegie's published numbers), then recovered by June.
  Chip exports did not recover: H2 2024 $34.6M vs $113.5M in H2 2023 (down 70%). **H**

## 9. Machine tools and bearings: where hubs have their own factories

- **Countries' own exports to Russia, 2021 to 2023.** Machine tools (HS 8457 to 8465): China $418M to
  $1,475M; Turkey $54M to $216M; Kazakhstan $1.3M to $48.2M; India $4.5M to $46.5M (and $111M in 2025).
  Germany fell from $261M to $1.8M (2024), Taiwan $112M to $9.7M (2024), Japan $30M to $0.6M. Bearings
  (HS 8482): China $41.5M to $206.7M; Turkey $3.6M to $44.7M; Kazakhstan $57.1M to $143.2M (2024); Germany
  $99.6M to about zero. **H** (2024 to 2025 zeros may be missing reports).
- **Local production fills much of the gap, and name lists do not touch it.** Half of Turkey's 86,565 bearing
  records say Turkish-made, and the top five shippers are unlisted Turkish makers. But two top-15 shippers,
  Egetir Otomotiv (928 records) and Bosfor Avrasya (860), are listed (OFAC, named in Treasury jy1978 of
  2023-12-12; UK 2024-06-13). **M-H**
- **Where there are no factories, the chip pattern returns (UAE).** UAE bearings into Russia: 9,738 records,
  3,643 Japan-made and only 850 UAE-made. Top shipper MOTO EXPORT DWC LLC (OFAC 2024-10-30) has 1,733; its
  records into Russia total 39,744 from 2020-07-12 to 2025-01-29 (12,532 of them left Japan directly), with
  its last record 3 months after listing. AUTO PARTS EAST FZCO is also OFAC-listed (2024-10-30). **H**
- **Official action.** In April 2026 the EU used its anti-circumvention tool for the first time, banning
  exports of CNC machines and radios to Kyrgyzstan (20th package). **H**

## 10. Climate commodities: plywood and aluminium

- **Plywood through Kazakhstan.** The EU banned Russian wood on 8 April 2022 (Regulation (EU) 2022/576).
  Kazakhstan's plywood exports went $0.45M (2021), $30.0M (2022), $83.0M (2023), $40.8M (2024). In 2023 it
  exported 95.0M kg and imported 85.8M kg, 59.2M kg of that from Russia: about as much out as in. Twelve EU
  countries reported plywood imports from Kazakhstan of $0 (2019 to 2021), $21.6M, $84.7M (2023), $39.6M;
  Poland alone took $65.8M in 2023. Russian plywood arriving directly fell from $608.8M (2021) to $2.0M (2023).
  **H**
- **Official confirmation.** On 2024-05-14 the European Commission extended anti-dumping duties on Russian
  birch plywood to goods sent from Kazakhstan and Turkey, finding they moved through or were finished there.
  2024 flows from both then dropped. About two years from ban to fix. **H**
- **Aluminium: a legal chain that screens clean.** Turkey is the largest destination for Russian aluminium
  (HS 7601) in Sayari's records: 9,011 records, then Uzbekistan 4,260 and China 3,252. Russia's largest
  aluminium producer is not on the US, UK or EU lists in our files. One Turkish alloy-wheel maker (unlisted)
  received 372 records of Russian aluminium 2019 to 2025 and exports wheels mainly to Germany, France, Spain
  and the Czech Republic, labelled Turkish origin. Nothing needs to change name: the metal becomes a wheel and
  its origin label changes. **H** for route counts, **L** that any given wheel contains Russian metal. Buying
  Russian aluminium was legal in Turkey and, for most of this period, in the EU.
- **Rules cover origin, not content.** Since 2024-04-13 the US bans imports of Russian-origin aluminium,
  copper and nickel (Treasury jy2249). Whether wheels cast in Turkey count: not verified. **H** for the rule.
- **Parent clean, subsidiaries listed.** Ten Norilsk-based firms were added to the US list on 2024-08-23
  (Treasury jy2546); the parent of Russia's main nickel miner is not on the lists in our files. **H**
- **No sign of relabelling in aluminium from Kazakhstan** (it has its own smelter; its Russian aluminium
  imports fell from $71.9M to $1.5M) **or in fertiliser** (Russian fertiliser stayed legal in the EU). **M**
- **Climate stakes (context, cited).** In July 2026, 150 of 268 tankers carrying Russian seaborne oil were
  "shadow fleet" ships, 93% of them over 15 years old (KSE Institute tracker). Oil and gas are planned at about
  22% of Russia's 2026 federal budget revenue (Finance Ministry plan as reported). **M**

## 11. Payments: new channels open in weeks

- **A bank as a channel.** OJSC Keremet Bank (Kyrgyzstan): OFAC 2025-01-15 under E.O. 14114; Treasury says it
  moved money for the listed Russian defence bank Promsvyazbank (PSB). **H**
- **Crypto and a quick rename.** After the Garantex exchange takedown on 2025-03-06, customers moved to Grinex,
  and a ruble token (A7A5) from Kyrgyz firm Old Vector was used (Treasury sb0225). Grinex, A7, A7 Agent, A71 and
  Old Vector: OFAC list-file date 2025-08-14. EU followed: Grinex 2025-10-23, A7 Agent and A71 2026-07-23,
  about 11 months later. **M-H**
- **Gold.** 1,338 records of gold (HS 7108) leaving Russia: UAE 683, Turkey 319, Hong Kong 162. UK records end
  2022-06-14; UAE records start 2022-04-22. Top sender VITABANK PJSC (230 records to 2023-05; OFAC 2024-11-21,
  18 months after its last record); next JSC Polyus Krasnoyarsk (169; OFAC 2023-05-19). The top UAE buyers
  are unlisted and not named. **M** (all gold records stop around the point where Russian records thin out).
- **Pressure on banks** (see section 8) cut China's exports for about three months and chips for longer.

## 12. Screening gaps: the flag is not the list

- **Sponsor flags were wrong in both directions.** ITIC LLC FZ, the top UAE shipper, was flagged "not
  sanctioned" though OFAC-listed (2024-06-12). On the UAE route the flag missed 6 of 7 listed shippers.
  MOTO EXPORT DWC LLC's top-level flag says clean while its risk list shows an OFAC "possible match". **H**
- **Strongest confirmed gap.** A Russian record "OOO FENIKS" shares its tax number, registration number and St
  Petersburg address with UK-listed LLC PHOENIX (UK RUS3475, designated 2026-02-24), yet the sponsor flags it
  not sanctioned. **H**
- **Spelling variants.** Four garbled records of RM Design and Development (same Bishkek address, 1,583 rows
  together) carry no sanctions flag in the sponsor data, but our fuzzy name checker catches all four (scores
  90.5 to 100). Every variant row predates the listing and sits with one importer each, so this reads as
  customs data entry, not deliberate evasion. **H**
- **Our own checker has blind spots too.** It reads asset-freeze lists only, so it misses every EU Annex IV
  (export-restriction) firm, such as Shisan and Rama Group's EU entry. It missed "Compel" for Kompel,
  "Intellect" for Intellekt, and the four-letter name GTME (OFAC 2023-07-20 as ZAO GTME Tekhnologii). Export
  denial lists (Denied Persons List, Entity List) also need checking, not only asset-freeze lists. **H**
- **False alarms happen.** A Tradeverifyd record for a major US chip designer carries 12 flags that belong to a
  neighbouring Iran network; none of our lists names the designer. **H**
- **Blind spots in the data.** The main source has no own trade records for Kyrgyzstan, Armenia, Georgia,
  Belarus, Iran and Hong Kong (seen only through partners). Example: the sponsor shows 2 Armenia-to-Russia chip
  records, while Armenia itself reported $13.1M in 2022. **H**

## 13. AI chips: same pattern, different part

- **Rules, with dates (official).** US advanced-chip controls 2022-10-07 and 2023-10-25 (88 FR 73458); AI
  Diffusion rule 2025-01-15, rescinded 2025-05-13; H200 and MI325X moved to case-by-case review 2026-01-15.
  Renting chips remotely in the cloud is not controlled. **H**
- **Chinese AI and chip firms on the BIS Entity List:** Sugon 2019-06-24, SMIC 2020-12-18, Cambricon
  2022-12-16, Inspur Group 2023-03-06, Biren and Moore Threads 2023-10-17, Zhipu and Sophgo (including its
  Singapore unit) 2025-01-16, Beijing Academy of Artificial Intelligence 2025-03-25. **H**
- **Russia: the route breaks at the invasion.** 2,474 records mentioning NVIDIA into Russia, 2019 to 2026
  (China 817, Ireland 237, Germany 211, Hong Kong 137, India 114). Shipments from the chip maker's own
  Singapore unit via Hong Kong stop at 2022-02-24; new Hong Kong and Shenzhen traders appear from 2022-05-11. **H**
- **Listed shippers and buyers, all records before listing:** Tornetcom (OFAC 2024-10-30), Innovio Ventures
  (BIS Entity List 2023-10-06, then OFAC), Guangzhou Chiphome (OFAC 2024-08-23), CTL Dis Ticaret (OFAC
  2023-09-14; Entity List 2024-02-23). Shreya Life Sciences (India; OFAC 2024-10-30) appears shipping NVIDIA
  Tesla V100 cards to Russia on 2023-04-27 and 2023-11-03. **H**
- **China is nearly dark in our data.** Only 2 H100 and 3 A100 records into China; of 495 "NVIDIA H100"
  records worldwide, India received 230, Vietnam 55, Kazakhstan 25, Malaysia 18, Singapore 16, China 2. **H**
- **Official cases show the scale we cannot see.** In March 2026 the US Justice Department charged three
  people over about $2.5B of servers bought in 2024 to 2025 by an unnamed Southeast Asian company and moved
  on to China; dummy servers were staged to pass an audit. A separate criminal complaint describes at least
  21 GPU shipments to forwarders in Singapore and Malaysia paid from Hong Kong and China. The think tank CNAS
  estimates a median of about 140,000 AI chips smuggled to China in 2024 (a model, not a count). **H** for
  what the documents say; charges are allegations until proven.

---

## Corrections applied in this branch

Everything below was caught by an independent checker on the day and is already reflected above.

- ELEM GROUP's first restriction is the BIS Entity List, 2023-12-07 (88 FR 85097), not OFAC 2024-02-23. The
  lag becomes at least 20 months and the lag range 15 to 20 months (was 15 to 23). The Entity List "Streloy"
  entry is LLC STRELOI (a 2013 company), not STRELOI EKOMMERTS.
- ITIC LLC FZ is sanctioned (OFAC 2024-06-12, EU 2025-02-25); the sponsor flag was wrong.
- Comtrade totals were double-counted; only aggregate rows are used ($13.5M, $18.3M, $13.1M, not $27.1M,
  $36.5M, $52.4M). The "Armenia $52M vs 2 records" comparison and "exports exceed imports" ratios are dropped.
- Sinno's OFAC date is 2022-09-30 (2023-04-20 is a dataset start date, not a listing date); its Entity List
  date is 2022-06-28 (effective), printed 2022-06-30. RM Design's OFAC date is 2023-07-20 (the Federal
  Register notice was published 2023-08-08).
- RM Design's records after listing: 40 of 76 on the Turkey leg (the earlier "25+" came from a partial page),
  and the move to Turkey began before the listing.
- A Turkish record with RM Design's exact alias cannot be shown to be the same company: moved to open leads.
  Several "gaps" were split duplicates of records the sponsor already flags.
- Kvazar and Snabinter are not RM Design buyers; "military-linked" is not in Treasury's text. GTME is listed.
  Rama Group's EU entry is Annex IV (export restriction), not an asset freeze.
- Rama Group: the Kyrgyz route stopped 525 days before listing; the firm kept shipping elsewhere.
- Hulm Al Sahra's OFAC date is 2023-04-12 (12 months), and its Entity List date is not used. Asia Material
  Solutions is a Hong Kong company shipping from the UAE.
- "Turkish top bearing shippers all unlisted" is wrong: Egetir and Bosfor are listed.
- Turkey bearings (14,574 records) had no saved file behind it at first and, once found, covered 2018 to 2026
  as a whole: dropped as a post-2022 claim.
- The "about 30% of Russia's budget from oil and gas" figure is replaced by about 22% (2026 plan).
