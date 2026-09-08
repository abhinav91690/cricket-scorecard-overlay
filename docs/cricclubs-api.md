# CricClubs overlay API

Everything we know about the CricClubs endpoints the overlay uses, learned by probing. None of it is
officially documented; treat field names as observed on 2026-09-07 (fixtures in `src/mockData.ts` were captured the same day) and re-verify with the curl commands
at the end if something looks off.

All endpoints are on `https://cricclubs.com`. Match and club IDs are the numeric ones in CricClubs URLs
(e.g. `matchId=2079`, `clubId=1089463` for LPCL).

## 1. `GET /liveScoreOverlayData.do?clubId=&matchId=`  (read, poll every 5s)

Public, CORS-open (works from any origin, no credentials). Returns JSON:

```
{
  view: number,                 // which overlay view the scorer/auto-switch has selected (see §3)
  values: { ... },              // the scorecard; string-typed, see below
  balls: string[],              // this over, oldest first: ".", "1", "4", "W", "1wd", "nb", "1lb", "1b"
  isSecondInningsStarted: bool, // also present as a *string* inside values
  isSuperOver: bool, isSuperOverSecondInningsStarted: bool, is2XCricket: bool,
  isAutoSwitchEnabled: 0|1,
  displayNickNameOnOverlay: bool,
  sponsorsImgPaths: string[],
  comments: string,
  overlayConfig: { ... }        // the club's overlay branding (§4)
}
```

### `values` conventions
- **Everything is a string**, including numbers and booleans: `isSecondInningsStarted: "true"`, `isMatchEnded: "1"`.
- Team 1 batted first. In a chase the batting side is team 2: `t2Total`, `t2Wickets`, `t2Overs`, `t2RR`.
- Run rates: `t1RR`, `t2RR`, `RRR` are two-decimal strings, or `"--.--"` when not applicable.
- Logos and profile pictures are **relative paths** (`/documentsRep/...`) unless they start with `http`; prefix `https://cricclubs.com`. `no-image` placeholders are common.
- `lastOutString` (and `batsman1OutString`) is **HTML**: `<span>b </span><span class='outname'>Name</span>`. In the card views `outStringNoLink` is the same text without markup; prefer it when present.
- `showMsgForScoreNeeded` is pre-built HTML ("INVADERS NEED 143 FROM 20.0 OVERS 7.15 RRR"). We compute our own from the totals instead.
- `totalOvers` is a number when present (match length), often absent.
- `batsman1*` is always the striker.

### `values` fields we use
`t1Name t2Name t1Code t2Code t1Total t2Total t1Wickets t2Wickets t1Overs t2Overs t1RR t2RR RRR totalOvers isSecondInningsStarted isMatchEnded result firstLogo secondLogo batsman1Name batsman1Runs batsman1Balls batsman1Fours batsman1Sixers batsman1ID batsman2… bowlerName bowlerRuns bowlerWickets bowlerOvers bowlerMaidens lastOutName lastOutRuns lastOutBalls lastOutString currentPartnershipMap{partnershipTotalRuns, partnershipTotalBalls, partnershipBatsman1/2ID, …FirstName} toss groundName seriesName`

The full key list of the default view is in `src/mockData.ts` (`mock_1stInnings`). Fields that are typed but empty in practice for this club: `t1Extras`/`t2Extras` (only in card views), `manOfTheMatch`, `momImagePath`, `sponsorsImgPaths`, `projectedRunRate`.

## 2. `GET /matchOverlayConfig.do?clubId=&matchId=&viewId=N`  (write: switch the view)

**Unauthenticated, CORS-allowed** (`access-control-allow-origin` echoes the caller's origin), responds `200` with body `success`. After it, every poll of §1 returns `view: N` and the extra data for that view. This is what the CricClubs control panel calls when the scorer clicks a view; anyone who knows the IDs can switch a match's overlay view, including ours. Calling it from the browser with `fetch()` works (unlike §5).

Auto-switch (`isAutoSwitchEnabled`) rotates views server-side; a manual switch is what the scorer sees too, so our overlay and CricClubs' own overlay for the same match change together.

## 3. Views

| viewId | CricClubs name | Extra `values` keys the payload gains |
|---|---|---|
| 1 | Default scorecard | none (baseline) |
| 2 / 4 | Batting card, team 1 / team 2 | `t1Batting` / `t2Batting` (full list, see row shape), `tXExtras`, `tXLogo`, `partnerShip` |
| 3 / 5 | Bowling card (team 2 bowls in innings 1) | `t2Bowling` / `t1Bowling`, `tXExtras`, `tXLogo`, `partnerShip` |
| 8 | Match summary | top 3 of `t1Batting t1Bowling t2Batting t2Bowling`, both `Extras`, both logos, `partnerShip` |
| 13 | Intro banner | logos, `t1Extras t2Extras partnerShip` |
| 14 / 15 | Innings break / Drinks break | logos, both `Extras`, `partnerShip`, `customTextValue` |
| 42 | Current scenario | `customTextValue` only |
| 45 | Current batters | `customTextValue` only |
| 48 / 49 | Team 1 / Team 2 info | `tXPlayersList` (squad: names, roles, styles, photo), `tXPlayerPics`, `tXPlayers` (string) |
| 53 | seen live post-match; not in fixtures | `customTextValue` only |
| 54 | "L" scorecard | `customTextValue` only |

**Data views drop the live fields.** Views 2/3/4/5/8/13/14/15/48/49 return only ~30–45 `values` keys: team names, totals, overs and the view's extra data. They do **not** include batter names/runs, the bowler, `lastOut*`, `currentPartnershipMap`, `toss`, and `balls` is always `[]`. Only views 1, 42, 45 and 54 carry the full scorebar. So an overlay must stay on view 1 while a ball can be bowled and only *peek* at a data view for one poll when nothing can be missed (pre-match, innings break, match over).

**Super overs swap the sides in the scorebar views.** Match 2079 (a tie) shows this: views 1/42/45/54 report `t1Name: Lions, t2Name: TOPGUNS UNITED` with the super-over totals (10 / 12, `isSuperOver: true`), while every data view keeps the main-match order (`t1 = TOPGUNS UNITED`, 188 each). Never pair a name or a total from a scorebar frame with a roster or crest from a data view; take names, totals, rosters and crests together from the data views.

`partnerShip` (fall of wickets) follows the **view's team**: views 2/3 give team 1's innings, 4/5 team 2's, and 8/13/14/15 the latest innings. Every view also carries `customTextValue` (free text the scorer typed) and `showMsgForScoreNeeded`.
Fixtures for each view live in `src/mockData.ts` as `mock_view_<id>`.

### Row shapes
- **Batting row**: `playerID firstName lastName shortName nickName battingPosition runsScored ballsFaced fours sixers isOut("0"|"1") howOut("ct","b",…) outStringNoLink outStringNickNamesNoLink wicketTaker1 wicketTaker2 innings profilepic_file_path battingStyle bowlingStyle playingRole isSecondary impactPlayerIn impactPlayerOut` and **`email`**.
- **Bowling row**: `playerID firstName lastName shortName nickName balls runs wickets maidens dotBalls wides noBalls hattricks innings profilepic_file_path bowlingStyle …` and **`email`**.
- **`partnerShip`**: `{ "1": 67, "2": 82, … }` = fall of wickets, wicket number → team score when it fell.

**No captain or wicketkeeper flag exists** in any view payload (squad rows carry only names, role, styles and a photo), and the team/scorecard HTML pages are behind the Cloudflare challenge. The line-up card renders a captain badge if a row ever carries `isCaptain`.

**Player rows include email addresses. Never render, log or store them; strip them before anything leaves memory (analytics, fixtures, screenshots).**

## 4. `overlayConfig` (club branding, in every §1 response)

```
overlayScorebarColor "#005fc0"   cpBGSecondColor "#295fd6"   secondaryColor ""   fontColor ""
logoS3Url  https://cricclubs.com/documentsRep/photos/<club logo>.png
isPowredBy true, powredByLogo1/2 (CricClubs "powered by" images)
overlayDelay 0 (seconds the club wants the overlay delayed to match the video)
overlayTheme 1, practiseSessionTheme 0, backgroundColorForVideo ""
```
Enough to derive a club-branded theme automatically.

## 5. `GET /updateLiveStreamURLFromCP.do?clubId=&matchId=&liveStreamURL=`  (write: attach a YouTube link)

Blocked as a cross-origin *subresource*: `fetch` (even `no-cors`), `<img>` and `<iframe>` fail on CORP plus WAF checks. A real top-level navigation works, so `liveStream.ts` opens it in a popup and closes it after ~2s. Success can only be confirmed by the §1 feed, which lags up to a minute. See commits `25ceb63`, `f7459e3`.

## 6. HTML pages (not usable from scripts)

`CricClubsLiveCP.do?clubId=&matchId=` (scorer control panel), `liveScoreOverlay.do` (their overlay), `overlayGraphics.do` sit behind a Cloudflare challenge; curl gets a 403 challenge page. Use a real browser if you need to see them.

## Probing recipes

```bash
D="https://cricclubs.com/liveScoreOverlayData.do?clubId=1089463&matchId=2079"
curl -s "$D" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['view'], sorted(d['values']))"

# switch a (finished, test) match to a view, look, then put it back
curl -s "https://cricclubs.com/matchOverlayConfig.do?clubId=1089463&matchId=2079&viewId=2"
curl -s "$D" | python3 -c "import sys,json; print(json.load(sys.stdin)['values']['t1Batting'][0])"
curl -s "https://cricclubs.com/matchOverlayConfig.do?clubId=1089463&matchId=2079&viewId=1"
```

Match 2079 (LPCL, finished) is a safe target for probing. Always restore the view you found. Behind the
corporate proxy, `python3 -c "urllib…"` fails on TLS; use curl and pipe the file into Python.
