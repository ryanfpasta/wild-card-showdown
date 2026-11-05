WILD CARD SHOWDOWN
==================
A phone party game hub for 3 to 8 players. One laptop runs the game; everyone
plays on their own phone's web browser (iPhone or Android). No app, no
accounts, no internet needed (just the same Wi-Fi or a phone hotspot).

Three games ("branches") share one table, one leaderboard and one finale:
  CARD CULPRIT  - answer a question, then guess who wrote each anonymous answer.
  BLUFF CLUB    - a weird TRUE fact with a blank. Write a believable fake,
                  then find the real answer among everyone's fakes.
  DOODLE DUEL   - draw your secret silly prompt with a finger, guess which
                  prompt each drawing was, then vote for the best.

Want it online so you don't need the laptop? See HOSTING.txt.
Want a private log of every game played (emailed to you on request)? See visitor-book/SETUP.txt.


STARTING THE GAME (on the laptop)
---------------------------------
1. Double-click start.bat. A black window opens - keep it open while you play.
2. The first time, Windows Firewall may ask about "Node.js".
   Tick "Private networks" and click "Allow access".
3. Your browser opens the BIG SCREEN with a QR code, the 4-letter table code
   and a "how to play" card carousel (click Skip if you know the games).
   Put it on the TV: press Windows key + K and pick your TV or Roku (laptop
   and TV on the same Wi-Fi), or use an HDMI cable. Click "Click for sound"
   once so the big screen can play sounds.

To stop the game, close the black window.


JOINING (on each phone)
-----------------------
1. Connect the phone to the SAME Wi-Fi as the laptop.
2. Scan the QR code with the camera, or type the address shown on the big screen.
3. Type your real name, then a character name (or tap "Shuffle me"), pick an
   emoji and a card colour, check the table code and tap "Join the table".
   Everyone sees both names, like "Doctor Otter (Leanne)".

A yellow "Your goal" banner stays at the top of every phone (and the big
screen) for the whole round. It says what you're trying to do right now
(fool people, guess the truth, draw so people can guess, or vote) and how
many points it's worth, plus any twist in play.
If a phone locks or drops out, open the page again: you get your seat,
look and score back. Players who join mid-game are dealt in next round.


THE DEALER (the first person to join)
-------------------------------------
Before the game, the dealer's phone shows the setup:
  - What to play: one game, all three in rotation, or a custom mix
    (in a mix each round picks randomly from the games you switched on)
  - Rounds: 3, 6, 9 or 12 (the last round is always the finale)
  - Wild card twists: never, rarely, sometimes, often or every round
  - Drawing timer (1, 1.5, 2 or 3 minutes) and the Doodle guessing round
  - Whether the finale includes the Showdown Duel
During the game the "Dealer" button gives: pause / resume, skip ahead,
skip the rest of the round, rename or remove players, and end the game.
If the dealer's phone drops out, the next player becomes dealer.


HOW A NIGHT GOES
----------------
Each round starts with a card flip: sometimes a WILD CARD twist:
  Double Down      every point this round counts double
  Steal            the round's top scorer steals 20% from the leader
  Underdog         last place scores double this round
  Mystery Round    the game stays secret until the last second
  Speed Round      every timer is cut in half
  Reverse Scoring  fooling people pays double, guessing right pays half
After every round: drumroll, then the leaderboard slides into place with
rank arrows, points earned, and live badges that can change hands
(Master Liar, Bloodhound, Truth Seeker, Picasso, Terrible Artist, Poker Face).

THE FINALE
  Final Wager: before the last round everyone secretly bets some of their
  points. The final round (a mystery game) is worth x3. Finish in the top
  half of that round to win your bet; otherwise you lose it.
  Showdown Duel (optional): the top 2 players (top 3 with 6+ players) play one
  more head-to-head round; everyone else is the audience and votes. Each
  audience vote is worth 200 points.
Then an awards show, one award at a time (Comeback Kid, Most Improved,
Biggest Heartbreak, High Roller, the badges, and the Champion), and the podium.

Scoring:
  Card Culprit  +100 correct guess, +50 to the writer per player fooled
  Bluff Club    +100 for picking the truth, +50 per player who picks your fake
                (if your "fake" is the real answer, it asks you to try again)
  Doodle Duel   +100 per favourite vote; in the guessing round +100 for the
                right prompt and +50 to the artist per correct guess


TROUBLESHOOTING
---------------
Phones can't open the page:
  - Check the phone is on the same Wi-Fi (not mobile data).
  - If the big screen shows a "Network" drop-down, pick the Wi-Fi one.
  - Windows Firewall may be blocking it: "Windows Defender Firewall" >
    "Allow an app through firewall" > "Node.js JavaScript Runtime" > tick
    "Private" (and "Public" if your Wi-Fi is set to Public).
  - Android Chrome (ERR_TOO_MANY_RETRIES): Chrome settings > Privacy and
    security > turn off "Always use secure connections"; and phone Settings >
    Apps > Chrome > Permissions > Nearby devices > Allow.
  - Guest/hotel/office Wi-Fi often blocks devices from seeing each other.
    Use a phone hotspot for the laptop, TV and phones instead.
No sound on the big screen: click "Click for sound" at the top right.
No sound on a phone: check the speaker button at the top and the silent switch.
(Vibration works on Android; iPhones don't allow web pages to vibrate.)


ADDING YOUR OWN CONTENT (open in Notepad, save, restart start.bat)
-------------------------------------------------------------------
  prompts.js           Card Culprit questions, one per line
  content/facts.js     Bluff Club facts:  question with ___ | real answer
  content/doodles.js   Doodle Duel prompts, one per line


ADDING A NEW GAME LATER
-----------------------
Each game is two files: games/<name>.js (rules and scoring on the laptop) and
public/games/<name>.js (what the phones and big screen show). The rules for
writing one are at the top of games/index.js. The hub handles everything else.


FOR TINKERING
-------------
Settings you can change before running "node server.js" (milliseconds):
  PORT (3000)  ANSWER_MS (90000)  GUESS_MS (30000)  VOTE_MS (30000)
  REVEAL_MS (9000)  SCORES_MS (25000)  INTRO_MS (5000)  WAGER_MS (30000)
  RECAP_MS (7000)  SHOW_MS (6000)  MIN_PLAYERS (3; start.bat sets 2 for testing)
Big screen: http://localhost:3000/host
