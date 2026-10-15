"""Spike: which vendor demo forms can an agent actually FILL (never submits)? Output: fixtures/form_survey.json + fixtures/form_proof/*.png"""
import json, re, sys, os, asyncio
from playwright.async_api import async_playwright

SITES = {
 "vanta":"https://www.vanta.com/demo","drata":"https://drata.com/demo","secureframe":"https://secureframe.com/demo",
 "sprinto":"https://sprinto.com/demo","scrut":"https://www.scrut.io/book-a-demo","hyperproof":"https://hyperproof.io/request-demo/",
}
DATA = {"first":"Priya","last":"Nair","full":"Priya Nair","email":"priya.nair@acme-solutions.example","company":"Acme Solutions",
        "phone":"+44 20 7946 0000","title":"Head of Engineering","website":"https://acme-solutions.example","employees":"28",
        "message":"[TEST - NOT SUBMITTED] SOC 2 Type II in 90 days, UK/EU data residency, budget under GBP 15k."}
OUT = sys.argv[1]
os.makedirs(f"{OUT}/form_proof", exist_ok=True)

def classify(meta):
    s = " ".join(str(meta.get(k,"")) for k in ("name","id","placeholder","label","aria")).lower()
    t = meta.get("type","")
    if t=="email" or "email" in s: return "email"
    if "first" in s: return "first"
    if "last" in s or "surname" in s: return "last"
    if "phone" in s or "tel" in s or t=="tel": return "phone"
    if "company" in s or "organi" in s or "business" in s: return "company"
    if "title" in s or "role" in s or "position" in s: return "title"
    if "website" in s or "url" in s or t=="url": return "website"
    if "employee" in s or "size" in s or "headcount" in s: return "employees"
    if "name" in s: return "full"
    if meta["tag"]=="textarea" or "message" in s or "comment" in s or "how can" in s: return "message"
    return None

JS = """(root)=>{
 const out=[];
 root.querySelectorAll('input,select,textarea').forEach(el=>{
  const r=el.getBoundingClientRect(); const cs=getComputedStyle(el);
  const visible = r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none';
  const type=(el.getAttribute('type')||'').toLowerCase();
  if(['hidden','submit','button','checkbox','radio'].includes(type)&&type!=='checkbox') { if(type!=='checkbox') return; }
  let label=''; if(el.id){const l=document.querySelector('label[for="'+el.id+'"]'); if(l) label=l.innerText;}
  if(!label){const p=el.closest('label,div,li'); if(p) label=(p.innerText||'').slice(0,60);}
  out.push({tag:el.tagName.toLowerCase(),type,name:el.name||'',id:el.id||'',placeholder:el.placeholder||'',label:label.trim().slice(0,60),aria:el.getAttribute('aria-label')||'',required:el.required||el.getAttribute('aria-required')==='true',visible, idx:out.length});
 }); return out;}"""

async def survey(browser, name, url):
    res = {"vendor":name,"url":url}
    ctx = await browser.new_context(viewport={"width":1366,"height":900}, user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")
    page = await ctx.new_page()
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=45000)
        await page.wait_for_timeout(4000)
        # dismiss cookie banners
        for sel in ["button:has-text('Accept all')","button:has-text('Accept All')","button:has-text('Accept')","button:has-text('Allow all')","#onetrust-accept-btn-handler"]:
            try:
                b = page.locator(sel).first
                if await b.is_visible(timeout=500): await b.click(timeout=1500); break
            except Exception: pass
        await page.wait_for_timeout(800)
        frames = [page.main_frame] + [f for f in page.frames if f != page.main_frame]
        best = None
        for fr in frames:
            try: fields = await fr.evaluate(JS, await fr.evaluate_handle("document.body"))
            except Exception: continue
            vis = [f for f in fields if f["visible"] and f["type"] not in ("checkbox",)]
            if best is None or len(vis) > len(best[1]): best = (fr, vis, fields)
        if not best or len(best[1]) < 3:
            res.update(status="no_form", visible_fields=0, note="no fillable form in main frame or iframes"); return res
        fr, vis, _ = best
        res["in_iframe"] = fr != page.main_frame
        filled, unfilled = [], []
        for f in vis:
            kind = classify(f)
            loc = fr.locator("input,select,textarea").nth(f["idx"]) if False else None
            # locate by name/id when possible, else by order among visible
        els = fr.locator("input:visible,select:visible,textarea:visible")
        n = await els.count()
        for i in range(n):
            el = els.nth(i)
            try:
                meta = await el.evaluate("""el=>{let label='';if(el.id){const l=document.querySelector('label[for="'+el.id+'"]');if(l)label=l.innerText}
                  if(!label){const p=el.closest('label,div,li');if(p)label=(p.innerText||'').slice(0,60)}
                  return {tag:el.tagName.toLowerCase(),type:(el.getAttribute('type')||'').toLowerCase(),name:el.name||'',id:el.id||'',placeholder:el.placeholder||'',label:label.trim(),aria:el.getAttribute('aria-label')||'',required:el.required||el.getAttribute('aria-required')==='true'}}""")
            except Exception: continue
            if meta["type"] in ("hidden","submit","button","radio","checkbox","image"): continue
            kind = classify(meta)
            row = {"kind":kind,"label":(meta["label"] or meta["placeholder"] or meta["name"])[:40],"required":meta["required"],"tag":meta["tag"]}
            try:
                if meta["tag"]=="select":
                    opts = await el.evaluate("el=>[...el.options].map(o=>o.text)")
                    pick = None
                    if kind=="employees":
                        pick = next((o for o in opts if re.search(r"(11|10)\s*[-–to]+\s*(50|99)|1-50|11-50|25|<\s*50|1\s*[-–]\s*50",o)), None)
                    pick = pick or next((o for o in opts[1:] if o.strip()), None)
                    if pick: await el.select_option(label=pick, timeout=2500); row["value"]=pick
                elif kind:
                    await el.fill(DATA.get(kind,""), timeout=2500); row["value"]=DATA.get(kind)
                else:
                    unfilled.append(row); continue
                filled.append(row)
            except Exception as e:
                row["err"]=str(e)[:60]; unfilled.append(row)
        html = (await page.content()).lower()
        res["captcha"] = bool(re.search(r"recaptcha|hcaptcha|turnstile", html))
        sub = fr.locator("button[type=submit]:visible,input[type=submit]:visible,button:visible:has-text('Demo'),button:visible:has-text('Submit'),button:visible:has-text('Get')")
        res["submit_button"] = (await sub.first.inner_text()).strip()[:40] if await sub.count() else None
        res.update(status="fillable" if len(filled)>=4 else "partial", filled=len(filled), unfilled=len(unfilled),
                   required_unfilled=[u["label"] for u in unfilled if u["required"]], fields=filled+unfilled)
        await page.screenshot(path=f"{OUT}/form_proof/{name}.png", full_page=False)
    except Exception as e:
        res.update(status="error", error=str(e)[:120])
    finally:
        await ctx.close()
    return res

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        results = await asyncio.gather(*[survey(b,n,u) for n,u in SITES.items()])
        await b.close()
    json.dump(results, open(f"{OUT}/form_survey.json","w"), indent=1)
    for r in results:
        print(r["vendor"], r.get("status"), "filled=",r.get("filled"), "unfilled=",r.get("unfilled"), "req_unfilled=",r.get("required_unfilled"), "captcha=",r.get("captcha"), "iframe=",r.get("in_iframe"), "submit=",r.get("submit_button"), r.get("error",""))
asyncio.run(main())
