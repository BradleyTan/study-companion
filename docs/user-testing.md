# StudyNest student test kit

A short kit for testing Phase 1 with one or more university students. Plan about 45 minutes per tester: 5 minutes to set up, 20 to 30 minutes on tasks (the 20-minute script below usually runs over on tasks 3 and 4, and that's fine), 10 minutes for the feedback form and a chat.

Live site: **https://study-companion-steel-kappa.vercel.app**

---

## 1. Before the test (Bradley's checklist)

**The day before**
- [ ] **Wake the database.** Open the live site and sign in. Supabase's free plan pauses a project after 7 days without use, and the first visit after a pause can fail or be very slow.
- [ ] **Do a quick run yourself.** Make one flashcard set, start one quiz and ask the chat one question. That shows the AI is answering, and these goes count only against your own daily limit.
- [ ] **Check that the magic-link email arrives** at an address that isn't yours, and see whether it lands in spam.
- [ ] **Prepare a sample file** in case the tester forgets theirs: a real lecture PDF or PPTX (25 MB at most) with plenty of text, not just slides of pictures. Keep it on your laptop and phone.
- [ ] **Ask the tester to bring** one of their own lecture files (PDF or PPTX) and, if they can, their university timetable exported as an `.ics` file (1 MB at most). The app imports a downloaded file only, never a link: if their uni system only offers a "Subscribe" link, they open that link in a browser first to download the `.ics` file.

**Limits to know** (from `src/lib/limits/ai.ts` and `docs/PLAN.md`; each student, each day)

| What | Per student per day |
|---|---|
| Flashcard sets | 15 |
| Mindmaps | 3 |
| Quizzes | 3 |
| Chat questions | 20 |
| File uploads | 20 files in 24 h, 25 MB each, 100 MB in total |

Making cards, a mindmap or a quiz again from exactly the same text, and retaking a quiz, don't use a go. A failed generation gives the go back. With 3 quizzes a day, a tester who makes a quiz and then uses "Practise what I missed" or "Practise weak topics" has used 2 of them.

- The AI allowance (Groq free plan) is **shared by the whole app**. Test **one person at a time** and don't test on a day you've already used the AI heavily.
- Everything is on free plans with no card attached. A test costs nothing.
- Sign-in emails go out through your Gmail at **about 30 an hour** (Supabase's email rate limit). A group session of more than a few people could hit that. One address can ask for a new link only once a minute; sooner, the app says "We couldn't send the link. Try again in a minute."

**Consent and privacy** (read this to the tester or send it in advance)
> "This is a test of the app, not of you. There are no wrong answers. If something is confusing, that's the app's fault and exactly what I need to know. I'll watch your screen and take notes, but I won't record unless you say yes. The app stores what you upload (your notes and lecture files) and sends text from them to a free AI service to make cards, quizzes and answers. The privacy page in the app explains this. You can stop at any time, and I'll delete your account and everything in it afterwards unless you want to keep using it."

- [ ] Get a clear "yes" before you start (a message is enough). If you'd like to record the screen, ask for that separately.
- [ ] Remind the tester not to upload anything they aren't allowed to share, such as files with other students' personal details.

**Deleting the tester's data afterwards**
- The tester (or you on their device) goes to **Settings → Delete account**, types `DELETE` and presses **Delete my account**. This deletes their account, notes and files, and turns off their calendar link straight away. It can't be undone.
- If they want to keep a copy first: **Settings → Your data → Download everything** (one JSON file with their subjects, notes, the list of uploaded files and the text read from them, flashcards, quizzes, chats, study sessions and timetable). The uploaded files themselves are not in it: they can download each one with **Open** on the file row first.
- If they added the private calendar link to Google, Apple or Outlook, tell them to remove that calendar from their calendar app too. The link stops working, but the calendar app may keep showing old events until they remove it.

---

## 2. Giving access

No invite step. The tester signs up with their own email.

1. Send them the link: **https://study-companion-steel-kappa.vercel.app** (phone or laptop both work; a laptop makes uploading files easier).
2. They tap **Start studying**, type their **own email address** and press **Email me a sign-in link**. The app says "Check your inbox".
3. They open the email **on the same device and in the same browser** they asked from, and tap the link. **If it hasn't come after a minute, check the spam or promotions folder.**
4. They land in the app, signed in. That's it.

Notes
- Google sign-in is hidden until it's turned on, so email is the only way in for now.
- The link only works in the browser the tester asked for it in (it is matched to that browser). Asking on a laptop and tapping the link on a phone, or the mail app opening it in its own built-in browser, ends on "That sign-in link has expired or was already used". On a phone: long-press the link and open it in Safari or Chrome, whichever they asked from. If it already failed, ask for a new link from the browser they'll use.
- If the link has expired (after an hour) or been used already, they just ask for a new one.
- Optional: on a phone they can use "Add to Home Screen" so the app opens like a normal app.

---

## 3. The 20-minute task script

### How to run it
- Sit beside them (or share screens). Let them hold the mouse or phone.
- Ask them to **think aloud**: "Please say what you're looking for, what you expect to happen and anything that surprises or annoys you."
- **Don't help** unless they've been stuck for about a minute. If they ask "what do I do?", reply "What would you try?" If you do step in, write down where and why. That's the most useful note you'll take.
- Read each task out exactly as written below, or show it on a card. Don't name buttons or menus.
- Keep an eye on time. If a task runs long, move on. Not finishing is a finding, not a failure.
- Sound is on by default. Ask them to keep it on unless they're somewhere quiet. You'll ask about it afterwards.

For each task, mark: **✓** done alone, **~** done with a hint, **✗** not done. Note the time taken and anything they say.

| # | Time | Task (read this to the tester) | What to watch for and note |
|---|---|---|---|
| 1 | 2 min | "Set up a subject for one of your courses this term." | Do they find how to add one? Do they choose a colour and emoji? Do they react to the look and sounds? |
| 2 | 3 min | "Add your lecture file to that subject, and write a short note of your own." | Do they find the upload? Do they understand the "Reading text…" status and wait for "Ready · N pages"? Any error? Does the note save without them worrying about it? |
| 3 | 4 min | "Make flashcards from your lecture file and study a few of them." | Do they find how to generate cards? Is the wait OK? Do they trust the cards (do they check the source passage)? Do they understand the review buttons (how well they knew it)? Do they try editing a card? Do they find read-aloud or the mindmap by themselves? |
| 4 | 4 min | "Test yourself with a short quiz on the same material. Then find out which topics you need to work on." | Do they pick a quiz type easily? How do they react to a wrong answer (tone of the feedback, the "boop")? Do they find the weak topics list afterwards? Do they understand what "Practise" will do? |
| 5 | 3 min | "Ask the app a question about your lecture that you'd normally have to search the slides for." | Is the answer useful? Do they click a source to check it? What happens when they ask something that isn't in their notes? |
| 6 | 2 min | "Start a study session for this subject, as if you were about to revise." | Do they find the timer? Do they understand the subject link and focus mode? Do they find it calming or distracting? (Let it run a moment, then they can stop it.) |
| 7 | 2 min | "Put your weekly classes into the app, then get them into the calendar you normally use." | If they brought an `.ics`: do they find the import, and do the classes look right? If not: do they add a class by tapping or dragging? Do they find the private calendar link and understand what it does? |

**If they finish early:** "Change one setting you'd want to change" (sound, theme, focus mode) and "Find out what the app does with your files" (privacy page).

**Before moving on, ask two quick questions:**
- "What was the most useful thing you saw?"
- "What was the most annoying or confusing moment?"

### Observer's note sheet (copy one per tester)

```
Tester:            Date:            Device: phone / laptop     Own file: yes / no     .ics: yes / no

Task  Result (✓ ~ ✗)  Time   Notes / quotes
1
2
3
4
5
6
7

Bugs or errors seen (what they did, what happened, screen):

Things they liked (their words):

Hints I had to give:
```

---

## 4. Feedback form (about 5 minutes)

Give this straight after the tasks. Easiest is to copy it into a free Google Form, or read it aloud and fill it in for them.

**Rate each from 1 (strongly disagree) to 5 (strongly agree)**

1. It was easy to work out how to use StudyNest.
2. The flashcards and quizzes were based on my lecture correctly (I'd trust them to study from).
3. The chat's answers were useful, and the sources helped me check them.
4. The app felt fun and motivating to use.
5. The app stayed calm enough that I could focus (sounds, animations, colours).
6. I'd feel comfortable putting my real lecture files into it.

**Choose one**

7. **Would you use this weekly during term?**
   ☐ Yes, definitely ☐ Probably ☐ Not sure ☐ Probably not ☐ No

8. **Which feature would you use most?** (pick up to 2)
   ☐ Notes and files per subject ☐ Flashcards and review ☐ Mindmap ☐ Read-aloud ☐ Quizzes and weak topics ☐ Ask-your-notes chat ☐ Study timer ☐ Timetable and calendar link

9. **What should we build next?** (pick up to 2)
   ☐ A progress page showing study hours, quiz scores and weak topics over time
   ☐ An exam countdown that plans what to revise before each exam
   ☐ Turning photos of handwritten notes into text you can study from
   ☐ Listening to your notes as a short podcast-style recording
   ☐ None of these. Fix or improve what's already there first.

**In your own words**

10. What was the most confusing or frustrating part?
11. What's one thing that would make you open this instead of what you use now?
12. Anything else? (bugs, ideas, things you liked)

---

## 5. After the test

### Same day
- Write up the observer sheet while it's fresh. Copy any bugs into an issue with the steps to repeat them.
- Delete the tester's data if they don't want to keep using the app (see section 1).

### How to read the results
- **Task results matter most.** A task that needed a hint or wasn't finished points to a real problem, even if the tester rated the app well afterwards. People are polite on forms.
- **Questions 1–6:** an average of **4 or more** is good, **3** means "works but needs work", and **2 or less** is a problem to fix before anything new.
- **Question 2 (trust in cards and quizzes)** and **question 6 (comfort with real files)** are the deal-breakers. If students don't trust the content or the privacy, nothing else matters.
- **Question 7** is the headline: "Yes, definitely" or "Probably" means real interest.
- **Question 9** tells you which Phase 2 item to start with. If "fix what's there first" comes up, take that seriously.
- With only one or two testers, treat the numbers as a conversation starter, not proof. The quotes and the stuck moments are the real data.

### Go / no-go for Phase 2

| Signal | Go | Fix first, then go | Not yet |
|---|---|---|---|
| Tasks 1–5 (the core study loop) | All done alone or with one hint | One or two need repeated hints | The tester couldn't get from a file to flashcards or a quiz |
| Trust in content (Q2) | 4–5 | 3 | 1–2, or they spotted wrong cards or answers |
| Comfort with real files (Q6) | 4–5 | 3 | 1–2 |
| Would use weekly (Q7) | "Yes, definitely" or "Probably" | "Not sure" | "Probably not" or "No" |
| Bugs | Only small or cosmetic | A bug that blocks one feature | Sign-in, upload or data loss broken |

- **Go:** mostly in the "Go" column. Start Phase 2 with the item testers picked most in question 9.
- **Fix first, then go:** fix the listed problems (usually a few days), ideally check them with one more student, then start Phase 2.
- **Not yet:** don't start Phase 2. Fix the core study loop and run this test again with a new student.

Record the decision and the main reasons in `docs/PLAN.md` and `docs/CHANGELOG.md`.
