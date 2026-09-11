# HTTP playground

Build an HTTP request, send it, and read what came back — like curl or Postman, but in this tab. Save the ones you use again, put the bits that change between staging and production into an environment, keep your API keys somewhere they will never reach a backup file, and chain requests into a flow that logs in and then uses the token. Find it under **Playgrounds** in the sidebar, or search for it with Ctrl/Cmd+K.

Everything it sends is something you pressed Send on.

_Describes the code as of v0.6.0 (schema v17) — verify against source when in doubt._

## Read this first: CORS

**Most APIs will refuse you here, and there is nothing this app can do about it.**

A page may only fetch another site if that site says it may. The browser asks; the server answers with an `Access-Control-Allow-Origin` header naming who is allowed; if the answer does not name this app, the browser throws the response away before this page ever sees it. That is the whole rule, and it is enforced by your browser, not by us.

What this means in practice:

- **A public API built for browsers will work.** They send the header on purpose.
- **Your own `localhost:3000` usually will not** — not until you add CORS headers to it, which is a one-line change in most frameworks and is worth doing for exactly this.
- **An API meant for servers usually will not**, because it was never expecting a browser and has no reason to send the header.
- **curl and Postman are not lying to you.** They are not browsers, so the rule does not apply to them. This is why a request that works there can fail here.
- **One host can allow some files and refuse others.** This is the case that looks most like a bug in this app, and it is not one. The header is attached per response, so a server rule matching only images and media — very common, and the default on more than one CDN — gives you a working `.png` and a refused `.csv` from the same directory. If one URL from a host works and another does not, the request is not what differs; the server's configuration is.

This page keeps track of which hosts have answered it during your session. Once a host has, a later refusal from it stops being a guess: the page will tell you outright that the host is fine and this particular address is not shared.

**No client that runs in a browser can get around this** — not this one, not one you write yourself, and not this app installed to your home screen, because an installed web app is still a browser page. If you need to call an API that will not have you, put something you control in between: a small proxy, or your own server making the call.

When a request fails this way the page says so, and says how sure it is. It cannot be certain: the browser deliberately gives a page the same blank error for a CORS refusal, a wrong hostname and a dropped connection, so that a page cannot go poking around a network it was not invited to.

## Read this second: where your API keys live

If you put a key into this tool, here is exactly what happens to it — all of it, in plain words, because "secret" is a word people reasonably read as "encrypted" and that is not what it means here.

**Secrets go in the Secrets table, not the Variables table.** They look alike and they are stored completely differently:

| | Variables | Secrets |
| --- | --- | --- |
| In your backup file | **yes** | **never** |
| In an exported environment | **yes** | never — only the *name* is listed |
| In a saved request | never — a saved request keeps the `{{name}}`, not the value | never |
| In a recorded flow run | never — masked before it is written down | never |
| Shown on screen | yes | masked, until you press Reveal on that one row |

A variable is the right place for a base URL. A secret is the right place for a key. Put a key in the variables table and it will be sitting in the next backup you take, in a file in your downloads folder, for as long as that file exists.

**What secrets are not:**

- **Not encrypted.** They are ordinary rows in this browser's storage, on this machine. Anything with access to this browser profile can read them. Keeping them out of your backups is what this feature does; protecting them from your own computer is not.
- **Not synced.** Nothing in this app is.
- **Not recoverable.** They are in one browser on one machine and no export includes them. If you clear this site's data they are gone.

**Deleting a secret really deletes it.** Everything else in this app keeps a small marker when you delete it so a future sync could tell. Secrets do not — a marker like that would still contain the value, so the whole row goes.

One thing to know: if a server *sends your key back to you* — some echo it in a response, and an authentication endpoint returns a credential by definition — a recorded flow run strips it back out before writing the record down, and tells you it did. The response you watched on screen is untouched.

## Using it

1. Pick a **method** and type a **URL**. It needs the `https://` — the page will not guess one, because guessing wrong is worse than asking.
2. **Headers** — add rows, untick one to leave it out without deleting it. Some names get a warning; see below.
3. **Body** — choose the kind:
   - **JSON** — an editor that checks as you type. Send stays disabled while it does not parse, with the position of the problem.
   - **Form** — key/value rows, sent as `application/x-www-form-urlencoded`. The exact bytes are shown, so nothing about the encoding is a surprise.
   - **Multipart** — fields plus files, for uploads.
   - **Raw** — whatever you type, with a `Content-Type` you choose.
   
   `GET` and `HEAD` carry no body; the page says so rather than letting the send fail.
4. **Send**, or **Cancel** while it is in flight.
5. The **response** shows the status and what family it belongs to, how long it took, how big it was, the headers, and the body.

## Variables

Anywhere in a URL, a header value, the body or a form field, write `{{name}}` and it will be filled in when you press Send.

- **Variables** live in an environment. Open **Environments and secrets**, pick which one you are editing, and add name/value rows.
- **Global** is always in scope. It is for the things that do not change between environments.
- **The active environment** is chosen in the picker above the request. Its values win over Global's, so `base_url` can mean staging in one and production in the other while the request stays the same.
- **Secrets** resolve exactly like variables and win over a variable of the same name. See above for where they live.

The **Variables** section of the request shows every placeholder, where each one resolved from, and what the request will actually be — with secret values masked. Open it before you send if you want to be sure.

**A name with nowhere to come from stops the send** and tells you which field it was in. It is never quietly replaced with nothing: sending `Authorization: Bearer` and getting a 401 back is the single most annoying way for an HTTP client to fail, because nothing anywhere tells you the token was missing.

You can also write `{{obj.field}}` and `{{list[0]}}`. A literal `{{` is written `\{{`.

**Adding them quickly.** When a request mentions variables that do not exist yet, a button appears under the URL: *Add N variables to Global* (or to whichever environment is active). It creates them all at once, **empty**, so you can fill in the values instead of typing every name twice.

Because they are empty, they now resolve — to nothing. That is deliberate: you created them, so the app does not overrule you. But an empty value in a request is the thing that produces a 401 with no explanation, so the Variables section lists every blank one at the top, shows `(empty)` in the value column, and — if the blank one is inside the URL — says so in the reason the send is blocked.

## Saving requests

Open **Saved requests**, give it a name, press Save. A saved request keeps its `{{placeholders}}` exactly as you wrote them — it is a template, resolved fresh every time you send it, not a snapshot of one send. That is what makes saving one safe when a placeholder resolves to a key.

## Flows

A flow runs several requests in order and carries values between them — log in, keep the token, use it on the next request.

1. Save the requests the flow will use.
2. Open **Flows** and create one. It starts with the log-in-then-fetch example sketched in.
3. For each step, choose which saved request it sends (or copy the one in the request card above into it).
4. On the step that produces something, add a **rule**: read `token` from the body, name it `token`. Later steps can then use `{{token}}`.
5. Press **Run all**, or walk it one step at a time.

Rules can read from the **body** (`token`, `data.token`, or `body[0].id` when the response is a list), a **header** by name, or the **status**.

Things worth knowing:

- **A rule that finds nothing says so.** It never becomes an empty string, so a renamed field shows up as a message rather than as a mystery 401 two steps later.
- **A failed step stops the run**, with the reason on that step. Nothing after it is attempted.
- **Extracted values live for the run only.** Tick **save** on a rule and you get a button to write it into the environment — that write is yours to make, never something running a flow does behind you.
- **The run you watch shows everything; the saved copy does not.** A token a step extracted is taken back out of the stored record — including the header the next step sent it in — because a live credential sitting in a backup file outlasts the token by a very long way. Come back after a reload and you will see `••••••••` where it was. If you need to check that the right value was carried, look while the run is on screen.
- **Extracted values beat environment ones**, so a token you just fetched wins over a stale one you left in a variable weeks ago.
- **Each flow keeps its most recent run** and nothing older. Recorded response bodies are cut off at 256 KB — the live view above is not.

## Gotchas

- **Some headers you type will not be sent, and the page warns you.** `Host`, `Origin`, `Cookie`, `Content-Length`, `Referer` and about fifteen others belong to the browser. It drops yours **silently** — this warning is the only notice you will get anywhere. It is a warning rather than an error because the row is perfectly legal; it just will not travel.
- **A 404 is an answer, not a failure.** So is a 500. The page shows them like any other response, because the server did reply — it replied "no". Only a request that never completed gets a diagnosis card.
- **Binary responses are always a download, and sometimes also a preview.** The page works out what a body is from its **bytes**, not from what the server called it, so a PNG labelled `text/plain` is still recognised as a PNG — and it will tell you the two disagreed. Images, PDFs, video and audio get a button that shows them here; **nothing is decoded until you press it**, and a large file says its size first.
- **Some real formats still cannot be shown, and the page says which.** A TIFF or a HEIC is a genuine image that no mainstream browser draws — there is no decoder to point at it. You get the reason rather than a button onto a blank box.
- **The PDF preview is the one frame here that is not sealed off.** Chrome refuses to start its PDF viewer inside a sealed frame at all, so the choice was this or no preview. A PDF cannot run scripts against this page the way an HTML page can, and downloading it to open elsewhere runs the very same viewer — but it is a difference worth knowing, and it is written next to the button.
- **HTML is shown as source first.** Press **Preview** to render it. That preview runs in a sealed frame with no origin of its own: the page you fetched cannot read this app's data, and cannot load anything of its own.
- **JSON, HTML, XML, CSS, JavaScript and Markdown responses are coloured in.** Very large or very dense bodies are shown plain instead, and the page says so rather than leaving you to wonder why this one is grey.
- **Cookies are never sent.** Not to anywhere, not ever, and there is no switch. This is a request builder, not a browser session — attaching your cookies to whatever address you typed would be a way to hand them to it.
- **A multipart body must not have a `Content-Type` you set.** The browser writes that header itself, because only it knows the boundary marker it chose. One you write names a boundary that is not in the body, and the server quietly reads no fields at all. The page warns if you add one.
- **Redirects are followed automatically**, and the final address is shown when it differs from the one you typed. You cannot see the intermediate hops.
- **A request is only saved when you press Save.** Whatever you were typing is not kept for you. The last request you saved and the environment you picked do come back on reload.
- **Deleting an environment deletes its secrets too**, and it warns you first. Saved requests grouped under it survive without one.
- **Sending needs a network; the page does not.** Crafting a request, editing variables and reading a recorded run all work offline like the rest of the app. Only the Send fails, and it says that is what happened.
