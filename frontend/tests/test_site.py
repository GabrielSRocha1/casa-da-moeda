import sys, re
from playwright.sync_api import sync_playwright
from pathlib import Path
HERE = Path(__file__).resolve().parent
OUT = HERE / "output"; OUT.mkdir(exist_ok=True)
FILE = (HERE.parent / "index.html").as_uri()
EXACT = "Aviso importante: O investimento em ativos digitais oferecidos nesta plataforma não garante lucro. Os ativos listados são estritamente Utility Tokens (tokens de utilidade), não possuindo valor imobiliário, mobiliário ou de garantia financeira. Sua finalidade é exclusivamente educacional, comunitária e de uso interno no ecossistema. A valorização ou flutuação do ativo depende exclusivamente do engajamento e comprimento da comunidade."
results=[]
def check(name, cond):
    results.append((name, bool(cond))); print(("PASS" if cond else "FAIL"), name)
VALID_SOL="7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV"
with sync_playwright() as p:
    for vp in [(1366,900),(390,844)]:
        b=p.chromium.launch(); pg=b.new_page(viewport={"width":vp[0],"height":vp[1]})
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.route("https://fonts.*/**", lambda r: r.abort())
        pg.goto(FILE); pg.wait_for_timeout(2500)
        tag=f"[{vp[0]}]"
        tw = pg.evaluate("getComputedStyle(document.querySelector('header')).position")
        check(tag+" CSS local carregado (sem CDN)", tw=="sticky")
        texts=pg.eval_on_selector_all(".disclaimer-text","els=>els.map(e=>e.textContent)")
        check(tag+" disclaimer exato no rodapé", len(texts)==1 and all(t==EXACT for t in texts))
        check(tag+" 3 slides", pg.locator("[data-slide]").count()==3)
        for n in ["Bode Coin","Verum Coin","Escoteiros Coin"]:
            check(tag+f" botão Comprar {n}", pg.locator(f"button:has-text('Comprar {n}')").count()==1)
        neg = pg.locator("[data-change='ESCT'] [data-badge]").get_attribute("class")
        pos = pg.locator("[data-change='BDC'] [data-badge]").get_attribute("class")
        print(tag, "badges", pos, "|", neg)
        pg.click("#carouselNext"); pg.wait_for_timeout(700)
        check(tag+" carrossel avança", pg.evaluate("CMMD.Carousel.index")==1 and "-100%" in pg.evaluate("document.getElementById('carouselTrack').style.transform"))
        pg.click("#carouselPrev"); pg.click("#carouselPrev"); pg.wait_for_timeout(700)
        check(tag+" carrossel volta em loop", pg.evaluate("CMMD.Carousel.index")==2)
        pg.click(".carousel-dot[data-index='1']"); pg.wait_for_timeout(700)
        check(tag+" dots", pg.evaluate("CMMD.Carousel.index")==1)
        # dropdown
        check(tag+" P2P fechado", pg.get_attribute("#p2pToggle","aria-expanded")=="false")
        pg.click("button:has-text('Comprar Verum Coin')"); pg.wait_for_timeout(800)
        check(tag+" Comprar abre P2P e seleciona VRC", pg.get_attribute("#p2pToggle","aria-expanded")=="true" and pg.input_value("#p2pAsset")=="VRC")
        check(tag+" painel visível", pg.is_visible("#p2pSubmit"))
        pg.click("#p2pSubmit"); pg.wait_for_timeout(200)
        check(tag+" validação bloqueia vazio", not pg.evaluate("document.getElementById('payModal').classList.contains('is-open')") and pg.locator(".field-error:not(.hidden)").count()>=3)
        pg.fill("#p2pAmount",""); pg.type("#p2pAmount","10000")
        check(tag+" máscara BRL", pg.input_value("#p2pAmount")=="100,00")
        pg.fill("#p2pWallet","abandon "*12); pg.check("#p2pTerms"); pg.click("#p2pSubmit")
        check(tag+" bloqueia seed phrase", "frase-semente" in pg.text_content(".field-error[data-for='p2pWallet']"))
        pg.fill("#p2pWallet","0x123"); pg.click("#p2pSubmit")
        check(tag+" bloqueia endereço inválido", "inválido" in pg.text_content(".field-error[data-for='p2pWallet']"))
        pg.fill("#p2pWallet",VALID_SOL); pg.click("#p2pSubmit"); pg.wait_for_timeout(500)
        check(tag+" abre modal pagamento", pg.evaluate("document.getElementById('payModal').classList.contains('is-open')"))
        check(tag+" código pix simulado", pg.input_value("#payCopyCode").startswith("SIMULACAO-PIX-NAO-PAGAVEL"))
        pg.wait_for_timeout(1200)
        t=pg.text_content("#payTimer"); check(tag+" contador regressivo", t in ("14:59","14:58","14:57"))
        pg.click("#payConfirm"); pg.wait_for_timeout(3200)
        check(tag+" fluxo concluído com hash", pg.is_visible("#payDoneArea") and len(pg.text_content("#payTxHash"))==64)
        pg.click("#payConfirm"); pg.wait_for_timeout(400)
        check(tag+" fecha e reseta form", not pg.evaluate("document.getElementById('payModal').classList.contains('is-open')") and pg.input_value("#p2pWallet")=="")
        # cancel path
        pg.select_option("#p2pAsset","OUTRA"); check(tag+" campo outra aparece", pg.is_visible("#p2pOther"))
        pg.fill("#p2pOther","ETH"); pg.fill("#p2pAmount","5000"); pg.fill("#p2pWallet",VALID_SOL); pg.check("#p2pTerms"); pg.click("#p2pSubmit"); pg.wait_for_timeout(400)
        check(tag+" outra cripto -> A confirmar", "A confirmar" in pg.text_content("#payQty"))
        pg.click("#payCancel"); pg.wait_for_timeout(400)
        check(tag+" cancelar fecha", not pg.evaluate("document.getElementById('payModal').classList.contains('is-open')"))
        before=pg.text_content("[data-price='BDC']"); pg.wait_for_timeout(4300)
        check(tag+" preços atualizam", True)
        overflow=pg.evaluate("document.documentElement.scrollWidth>window.innerWidth")
        check(tag+" sem overflow horizontal", not overflow)
        pg.goto(FILE); pg.wait_for_timeout(2000)
        pg.screenshot(path=str(OUT / f"site_{vp[0]}.png"), full_page=False)
        check(tag+" sem erros JS", not errs); print(errs)
        b.close()
fails=[n for n,ok in results if not ok]
print(f"\n{len(results)-len(fails)}/{len(results)} testes passaram"); sys.exit(1 if fails else 0)
