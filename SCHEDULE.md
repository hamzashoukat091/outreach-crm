# The send window, and what the times mean

The engine only sends inside a window you set. This explains what the fields
mean, why they are in UTC, and what the window looks like from each country.

## Current configuration

| Setting | Value |
|---|---|
| Timezone | **UTC** |
| Window | **12:00 – 20:00** (noon to 8pm) |
| Days | **Mon – Fri** |
| Limits | **2 per hour, 10 per day** |
| Default delay | 1 day |
| Default send time | 13:00 UTC |

Set in **Settings → Schedule**. Saves on its own; no deploy needed.

## Reading the clock

The UI shows 12-hour time. In 24-hour terms:

- `12:00 PM` = **noon** (12:00), not midnight
- `08:00 PM` = **20:00**, eight in the evening

So the window is eight hours long, from midday to evening UTC.

## Why UTC

The server runs UTC, so the setting matches it exactly. What the dashboard
says is what the machine does — no conversion anywhere, and nothing to get
wrong twice a year when other countries change their clocks.

The timezone field is **not** about where the code runs. It answers one
question: *9am in whose day?* Setting it to UTC means the window is defined in
the same terms the server already thinks in.

## The window, by country

Sorted west to east. **Opens** and **closes** are local time in each place.

### Behind UTC — subtract

| Country | Offset | Opens | Closes | |
|---|---|---|---|---|
| US — Los Angeles | UTC−7 | 5:00 AM | 1:00 PM | early |
| US — Denver | UTC−6 | 6:00 AM | 2:00 PM | good |
| US — Chicago | UTC−5 | 7:00 AM | 3:00 PM | good |
| **US — New York** | **UTC−4** | **8:00 AM** | **4:00 PM** | **ideal** |
| Canada — Toronto | UTC−4 | 8:00 AM | 4:00 PM | ideal |
| Brazil — São Paulo | UTC−3 | 9:00 AM | 5:00 PM | ideal |

### At UTC

The server, and where the window is defined: opens noon, closes 8pm.

### Ahead of UTC — add

| Country | Offset | Opens | Closes | |
|---|---|---|---|---|
| UK, Ireland, Portugal, Nigeria | UTC+1 | 1:00 PM | 9:00 PM | afternoon |
| Germany, France, Spain, Netherlands, Poland, South Africa | UTC+2 | 2:00 PM | 10:00 PM | afternoon |
| Turkey, Saudi Arabia, Egypt | UTC+3 | 3:00 PM | 11:00 PM | evening |
| UAE — Dubai | UTC+4 | 4:00 PM | 12:00 AM | evening |
| **Pakistan** | **UTC+5** | **5:00 PM** | **1:00 AM** | your evening |
| India | UTC+5:30 | 5:30 PM | 1:30 AM | evening |
| Bangladesh | UTC+6 | 6:00 PM | 2:00 AM | night |
| Thailand | UTC+7 | 7:00 PM | 3:00 AM | night |
| China, Singapore | UTC+8 | 8:00 PM | 4:00 AM | night |
| Japan, South Korea | UTC+9 | 9:00 PM | 5:00 AM | night |
| Australia — Sydney | UTC+10 | 10:00 PM | 6:00 AM | night |
| New Zealand | UTC+12 | 12:00 AM | 8:00 AM | night |

**For Pakistan: UTC + 5 = local time.** Noon UTC is 5pm here; 20:00 UTC is
1am the next day, which is why the close crosses midnight.

## Why the window looks wrong on a Pakistani clock

Sending happens between **5pm and 1am** local. That is deliberate.

The prospects read the email, not the sender. The current list is US and
European companies, and **noon UTC is 8am in New York** — someone opening
their laptop to start the day, which is the best moment for a cold email to
land.

Pakistan is UTC+5 and New York is UTC−4: **nine hours apart**. No window is
daytime in both. Aiming at the recipient's morning necessarily means the
sender's evening.

Anything from **UTC+6 eastward gets mail at 2–5am**. If the list ever targets
Asia-Pacific, the window has to move.

### The alternative

`04:00 – 12:00 UTC` is 9am–5pm in Pakistan — comfortable locally, but
midnight to 8am in New York. Pick based on where the prospects are, not where
you are.

## The three schedule fields

**Window opens / closes** — the gate. Nothing leaves outside it, ever. A
message due at a closed hour is deferred to the next opening, not dropped.

**Default delay (days)** — how long a *draft now, send later* enrollment
waits before sending. At 1, Claude writes today and it goes tomorrow, so
there is time to read it first.

**Default send time** — what time on that later day, for steps that do not
set their own.

> This one has a trap: it must sit **inside** the window. It was 21:00 while
> the window was 12:00–20:00, so every message using it was pushed to the
> next day. Now 13:00 — an hour into the window, and 9am in New York.

## Worked examples

Enrolling on a Tuesday at 15:32 UTC, window open:

| Option | Sends |
|---|---|
| Send as soon as possible | **immediately**, 15:32 UTC |
| Write now, send in 2 days | Wed **13:00 UTC** = 9:00am New York |

When the window is shut:

| Attempted | Result |
|---|---|
| 23:00 Tuesday | deferred to **Wed 12:00 UTC** (8am NY) |
| 14:00 Saturday | deferred to **Mon 12:00 UTC** — the weekend is skipped |

A three-step sequence enrolled Tuesday with *write now, send in 2 days*:

```
1. Wed 26 Aug 13:00 UTC   9am NY    opener
2. Sat 29 Aug -> Mon 31   9am NY    demo (day 3, weekend skipped)
3. Mon  7 Sep 13:00 UTC   9am NY    breakup
```

A reply at any point cancels the rest.

## Daylight saving

The US and Europe shift an hour; **Pakistan does not**. In November New York
becomes UTC−5, so noon UTC lands at 7:00am there instead of 8:00.

Nothing to change — the app stores real timezone names, not fixed offsets, so
the conversion follows the rules automatically. Worth knowing only so the
numbers above are not a surprise when they move.

## Rate limits

**2 per hour, 10 per day** — deliberately low. A new sending account with no
reputation looks like a spammer if it suddenly emits volume. See GMAIL.md for
the deliverability side.

Gmail's own hard cap is 500/day regardless of what is set here.
