# HTTP playground

Build an HTTP request, send it, and read what came back — like curl or Postman, but in this tab. Find it under **Playgrounds** in the sidebar, or search for it with Ctrl/Cmd+K. Nothing is saved: this page keeps nothing between visits, and everything it sends is something you pressed Send on.

_Describes the code as of v0.4.0 (unreleased; schema v14) — verify against source when in doubt._

## Read this first: CORS

**Most APIs will refuse you here, and there is nothing this app can do about it.**

A page may only fetch another site if that site says it may. The browser asks; the server answers with an `Access-Control-Allow-Origin` header naming who is allowed; if the answer does not name this app, the browser throws the response away before this page ever sees it. That is the whole rule, and it is enforced by your browser, not by us.

What this means in practice:

- **A public API built for browsers will work.** They send the header on purpose.
- **Your own `localhost:3000` usually will not** — not until you add CORS headers to it, which is a one-line change in most frameworks and is worth doing for exactly this.
- **An API meant for servers usually will not**, because it was never expecting a browser and has no reason to send the header.
- **curl and Postman are not lying to you.** They are not browsers, so the rule does not apply to them. This is why a request that works there can fail here.

**No client that runs in a browser can get around this** — not this one, not one you write yourself, and not this app installed to your home screen, because an installed web app is still a browser page. If you need to call an API that will not have you, put something you control in between: a small proxy, or your own server making the call.

When a request fails this way the page says so, and says how sure it is. It cannot be certain: the browser deliberately gives a page the same blank error for a CORS refusal, a wrong hostname and a dropped connection, so that a page cannot go poking around a network it was not invited to.

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

## Gotchas

- **Some headers you type will not be sent, and the page warns you.** `Host`, `Origin`, `Cookie`, `Content-Length`, `Referer` and about fifteen others belong to the browser. It drops yours **silently** — this warning is the only notice you will get anywhere. It is a warning rather than an error because the row is perfectly legal; it just will not travel.
- **A 404 is an answer, not a failure.** So is a 500. The page shows them like any other response, because the server did reply — it replied "no". Only a request that never completed gets a diagnosis card.
- **Binary responses are offered as a download, not displayed.** The page works out what a body is from its **bytes**, not from what the server called it, so a PNG labelled `text/plain` is still recognised as a PNG — and it will tell you the two disagreed.
- **HTML is shown as source first.** Press **Preview** to render it. That preview runs in a sealed frame with no origin of its own: the page you fetched cannot read this app's data, and cannot load anything of its own.
- **Cookies are never sent.** Not to anywhere, not ever, and there is no switch. This is a request builder, not a browser session — attaching your cookies to whatever address you typed would be a way to hand them to it.
- **A multipart body must not have a `Content-Type` you set.** The browser writes that header itself, because only it knows the boundary marker it chose. One you write names a boundary that is not in the body, and the server quietly reads no fields at all. The page warns if you add one.
- **Redirects are followed automatically**, and the final address is shown when it differs from the one you typed. You cannot see the intermediate hops.
- **Nothing is saved.** Reloading gives you a blank request. Saved requests and environments are coming, but they are not here yet.
- **Sending needs a network; the page does not.** Crafting a request works offline like the rest of the app. Only the Send fails, and it says that is what happened.
