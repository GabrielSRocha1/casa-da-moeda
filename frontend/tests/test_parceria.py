import json, sys, re
from playwright.sync_api import sync_playwright
from pathlib import Path
HERE = Path(__file__).resolve().parent
OUT = HERE / "output"; OUT.mkdir(exist_ok=True)
FILE = (HERE.parent / "index.html").as_uri()
SB = "https://projeto-teste.supabase.co"
KEY = "eyJhbGciOiJIUzI1NiJ9.anon-key-de-teste-1234567890"
results=[]; captured=[]
def check(name, cond, extra=""):
    results.append((name,bool(cond))); print(("PASS" if cond else "FAIL"), name, ("→ "+str(extra)) if (not cond and extra) else "")

def setup(p, vp, configure=True):
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":vp[0],"height":vp[1]})
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.route("https://fonts.*/**", lambda r: r.abort())
    pg.goto(FILE); pg.wait_for_timeout(600)
    if configure:
        pg.evaluate(f"""() => {{ document.querySelector('meta[name="cmmd-supabase-url"]').content = '{SB}';
                                document.querySelector('meta[name="cmmd-supabase-anon-key"]').content = '{KEY}'; }}""")
    return b, pg, errs

def fill_all(pg, sector="Eventos e Festas Sertanejas"):
    pg.fill("#pfCompanyName","Associação Cultural Vale do Sol")
    pg.fill("#pfAddress","Rua das Palmeiras, 120 - Centro, Campina Grande - PB, 58400-000, Brasil")
    pg.select_option("#pfSector", sector)
    pg.fill("#pfDescription","Organizamos a festa junina regional há 15 anos, com 40 mil visitantes por edição.")
    pg.click("#pfNext"); pg.wait_for_timeout(150)
    pg.fill("#pfDirector","Maria Aparecida Souza")
    pg.fill("#pfWhatsapp",""); pg.type("#pfWhatsapp","83991234567")
    pg.fill("#pfEmail","Diretoria@ValeDoSol.org.br")
    pg.click("#pfNext"); pg.wait_for_timeout(150)
    pg.click("button.pf-days-preset[data-days='SEG,TER,QUA,QUI,SEX']")
    pg.click("label.pf-chip:has(input[value='TARDE'])")
    pg.fill("#pfTimeFrom","14:00"); pg.fill("#pfTimeTo","18:00")
    pg.check("#pfConsent")

with sync_playwright() as p:
    for vp in [(1366,900),(390,844)]:
        tag=f"[{vp[0]}]"
        b,pg,errs=setup(p,vp)
        # ---------- seção na página
        check(tag+" vitrine com 9 ramos", pg.locator("#sectorShowcase button").count()==9)
        check(tag+" sem formulário antigo de token", pg.locator("#b2bSymbol, #b2bCategories").count()==0)
        # ---------- abrir pelo botão principal
        pg.locator("[data-open-b2b]:visible").first.click(); pg.wait_for_timeout(400)
        check(tag+" modal abre", pg.evaluate("document.getElementById('b2bModal').classList.contains('is-open')"))
        if vp[0]<1024:
            sc = pg.evaluate("document.getElementById('pfScroll').scrollTop")
            check(tag+" celular abre no topo (card visível)", sc==0 and pg.locator("#benefitsTitle").is_visible() and pg.evaluate("document.activeElement.id")!="pfCompanyName", sc)
        title = pg.text_content("#benefitsTitle").strip()
        check(tag+" card de vantagens: título", title=="Por que tokenizar sua instituição na Casa da Moeda Master Digital?")
        items = pg.locator("aside[aria-labelledby='benefitsTitle'] ol li").all_inner_texts()
        check(tag+" card de vantagens: 3 itens", len(items)==3 and "Ecossistema Verum Crypto" in items[0] and "Verum Wallet" in items[1] and "Global Pay" in items[2], items)
        card = pg.locator("aside[aria-labelledby='benefitsTitle']").bounding_box()
        form = pg.locator("#pfForm").bounding_box()
        if vp[0]>=1024: check(tag+" card ao lado do formulário (desktop)", card["x"]+card["width"]<=form["x"]+2 and abs(card["y"]-form["y"])<5, (card,form))
        else:           check(tag+" card acima do formulário (celular)", card["y"]+card["height"]<=form["y"]+2, (card,form))
        opts = pg.eval_on_selector_all("#pfSector option","els=>els.map(e=>e.value).filter(Boolean)")
        check(tag+" dropdown com os 9 ramos", opts==["Empresas e Negócios","Eventos e Festas Sertanejas","Times de Futebol / Esportes","Feiras Culturais","Ajuda Humanitária / ONGs","Igrejas e Instituições Religiosas","Clubes Recreativos","Fraternidades e Lojas","Outros"], opts)
        # ---------- validação etapa 1
        pg.click("#pfNext"); pg.wait_for_timeout(150)
        check(tag+" etapa 1 bloqueia vazio (4 erros)", pg.locator("#pfForm .field-error:not(.hidden)").count()==4 and pg.evaluate("CMMD.Partnership.step")==1)
        pg.select_option("#pfSector","Outros")
        check(tag+" 'Outros' mostra campo extra", pg.is_visible("#pfSectorOther"))
        pg.fill("#pfCompanyName","Cooperativa Agro Sul"); pg.fill("#pfAddress","Av. Brasil, 1000, Cascavel - PR")
        pg.fill("#pfDescription","Cooperativa com 300 produtores rurais associados na região oeste.")
        pg.click("#pfNext"); pg.wait_for_timeout(150)
        check(tag+" 'Outros' exige descrição do ramo", pg.is_visible(".field-error[data-for='pfSectorOther']") and pg.evaluate("CMMD.Partnership.step")==1)
        pg.fill("#pfSectorOther","Cooperativa agrícola"); pg.click("#pfNext"); pg.wait_for_timeout(150)
        check(tag+" avança para etapa 2", pg.evaluate("CMMD.Partnership.step")==2)
        # ---------- validação etapa 2
        pg.fill("#pfDirector","Maria"); pg.type("#pfWhatsapp","1234"); pg.fill("#pfEmail","sem-arroba"); pg.fill("#pfPhone","99")
        pg.click("#pfNext"); pg.wait_for_timeout(150)
        errs2 = pg.eval_on_selector_all("#pfForm .field-error:not(.hidden)","els=>els.map(e=>e.dataset.for)")
        check(tag+" etapa 2 valida nome, WhatsApp, telefone e e-mail", set(errs2)=={"pfDirector","pfWhatsapp","pfPhone","pfEmail"}, errs2)
        pg.fill("#pfWhatsapp",""); pg.type("#pfWhatsapp","11912345678")
        check(tag+" máscara BR no WhatsApp", pg.input_value("#pfWhatsapp")=="(11) 91234-5678")
        check(tag+" normaliza E.164 (BR/PY/+intl)", pg.evaluate("[CMMD.normalizePhone('55','(11) 91234-5678'), CMMD.normalizePhone('595','0981 123 456'), CMMD.normalizePhone('55','+351912345678'), CMMD.normalizePhone('55','(11) 81234-5678')]")==["+5511912345678","+595981123456","+351912345678",None])
        # ---------- rascunho: fechar e reabrir mantém dados
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
        pg.locator("[data-open-b2b]:visible").first.click(); pg.wait_for_timeout(400)
        check(tag+" rascunho restaurado ao reabrir", pg.input_value("#pfCompanyName")=="Cooperativa Agro Sul" and pg.evaluate("CMMD.Partnership.step")==2)
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
        pg.evaluate("localStorage.clear()")
        # ---------- abrir por um ramo da vitrine preseleciona
        pg.locator("#sectorShowcase button", has_text="Igrejas").click(); pg.wait_for_timeout(400)
        check(tag+" ramo da vitrine vem pré-selecionado", pg.input_value("#pfSector")=="Igrejas e Instituições Religiosas" and pg.evaluate("CMMD.Partnership.step")==1)
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300); pg.evaluate("localStorage.clear()")

        # ---------- envio completo com Supabase
        calls=[]
        def handler(route):
            req=route.request
            calls.append({"headers":req.headers,"body":json.loads(req.post_data),"method":req.method})
            mode = pg.evaluate("window.__sbMode || 'ok'")
            if mode=="ratelimit":
                route.fulfill(status=400, content_type="application/json", body=json.dumps({"code":"23514","message":"TOO_MANY_APPLICATIONS: já recebemos solicitações recentes deste contato."}))
            elif mode=="network": route.abort()
            elif mode=="dup": route.fulfill(status=409, content_type="application/json", body=json.dumps({"code":"23505","message":"duplicate key value violates unique constraint \"business_applications_pkey\""}))
            else: route.fulfill(status=201, body="")
        pg.route(SB+"/rest/v1/business_applications", handler)
        pg.locator("[data-open-b2b]:visible").first.click(); pg.wait_for_timeout(400)
        fill_all(pg)
        check(tag+" botão final verde com rótulo correto", pg.text_content("#pfNext").strip()=="Enviar Solicitação de Parceria" and "bg-up" in pg.get_attribute("#pfNext","class"))
        pg.uncheck("#pfConsent"); pg.fill("#pfTimeTo","13:00"); pg.click("#pfNext"); pg.wait_for_timeout(150)
        errs3 = pg.eval_on_selector_all("#pfForm .field-error:not(.hidden)","els=>els.map(e=>e.dataset.for)")
        check(tag+" etapa 3 valida consentimento e janela de horário", set(errs3)=={"pfConsent","pfTimeTo"} and len(calls)==0, errs3)
        pg.fill("#pfTimeTo","18:00"); pg.check("#pfConsent")
        # erro do banco (antispam)
        pg.evaluate("window.__sbMode='ratelimit'"); pg.click("#pfNext"); pg.wait_for_timeout(500)
        check(tag+" erro do banco aparece em vermelho e mantém dados", pg.is_visible("#pfSubmitError") and "solicitações recentes" in pg.text_content("#pfSubmitError") and pg.evaluate("CMMD.Partnership.step")==3)
        # falha de rede
        pg.evaluate("window.__sbMode='network'"); pg.click("#pfNext"); pg.wait_for_timeout(500)
        check(tag+" falha de rede tratada", "internet" in pg.text_content("#pfSubmitError"))
        # reenvio cujo 1º chegou ao banco → 409 pkey = sucesso, mesmo id
        pg.evaluate("window.__sbMode='dup'"); pg.click("#pfNext"); pg.wait_for_timeout(600)
        check(tag+" reenvio usa o mesmo id (sem duplicar)", len(calls)==3 and len({c['body']['id'] for c in calls})==1)
        check(tag+" sucesso exibido", pg.evaluate("CMMD.Partnership.step")=="done" and pg.is_visible("#pfSuccessText"))
        body=calls[-1]["body"]; h=calls[-1]["headers"]
        check(tag+" headers do Supabase (apikey, Bearer, return=minimal)", h.get("apikey")==KEY and h.get("authorization")=="Bearer "+KEY and h.get("prefer")=="return=minimal" and calls[-1]["method"]=="POST")
        check(tag+" payload normalizado", body["whatsapp"]=="+5583991234567" and body["email"]=="diretoria@valedosol.org.br" and body["preferred_days"]==["SEG","TER","QUA","QUI","SEX"] and body["preferred_periods"]==["TARDE"] and body["preferred_time_from"]=="14:00" and body["alt_phone"] is None and body["business_sector_other"] is None and body["consent_lgpd"] is True, body)
        proto = pg.text_content("#pfProtocol")
        check(tag+" protocolo derivado do id", proto=="PAR-"+body["id"].replace("-","")[:10].upper())
        msg = pg.text_content("#pfSuccessText")
        check(tag+" mensagem cita contato nos horários informados", "entrará em contato" in msg and "segunda a sexta-feira" in msg and "tarde (12h–18h)" in msg and "das 14:00 às 18:00" in msg and "Maria" in msg, msg)
        check(tag+" sem aviso de modo demonstração", not pg.is_visible("#pfDemoNote"))
        check(tag+" rascunho apagado após envio", pg.evaluate("localStorage.getItem('cmmd_partnership_draft')") is None)
        captured.append(body)
        pg.click("#pfNext"); pg.wait_for_timeout(300)
        check(tag+" sucesso sem botão Voltar", not pg.is_visible("#pfBack"))
        check(tag+" 'Fechar' fecha o modal", not pg.evaluate("document.getElementById('b2bModal').classList.contains('is-open')"))
        # nova solicitação começa limpa
        pg.locator("[data-open-b2b]:visible").first.click(); pg.wait_for_timeout(400)
        check(tag+" nova solicitação começa limpa", pg.input_value("#pfCompanyName")=="" and pg.evaluate("CMMD.Partnership.step")==1)
        # 2ª solicitação com 'Outros' + telefone alternativo PY
        pg.select_option("#pfSector","Outros"); pg.fill("#pfSectorOther","Cooperativa agrícola")
        pg.fill("#pfCompanyName","Cooperativa Agro Sul"); pg.fill("#pfAddress","Av. Brasil, 1000, Cascavel - PR, Brasil")
        pg.fill("#pfDescription","Cooperativa com 300 produtores rurais associados na região oeste.")
        pg.click("#pfNext"); pg.wait_for_timeout(150)
        pg.fill("#pfDirector","João Pedro Martins"); pg.type("#pfWhatsapp","45999887766")
        pg.select_option("#pfPhoneDdi","595"); pg.fill("#pfPhone","0981 123 456"); pg.fill("#pfEmail","joao@agrosul.coop")
        pg.click("#pfNext"); pg.wait_for_timeout(150)
        pg.click("label.pf-chip:has(input[value='SAB'])"); pg.click("label.pf-chip:has(input[value='MANHA'])"); pg.click("label.pf-chip:has(input[value='NOITE'])")
        pg.select_option("#pfTimezone","America/Asuncion"); pg.check("#pfConsent")
        pg.evaluate("window.__sbMode='ok'"); pg.click("#pfNext"); pg.wait_for_timeout(500)
        b2=calls[-1]["body"]
        check(tag+" 2º envio: Outros + telefone PY", b2["business_sector"]=="Outros" and b2["business_sector_other"]=="Cooperativa agrícola" and b2["alt_phone"]=="+595981123456" and b2["timezone"]=="America/Asuncion" and b2["preferred_time_from"] is None, b2)
        check(tag+" 2º envio: texto com sábado e períodos", "nos dias sábado" in pg.text_content("#pfSuccessText") and "manhã (8h–12h) e noite (18h–21h)" in pg.text_content("#pfSuccessText"), pg.text_content("#pfSuccessText"))
        captured.append(b2)
        if vp[0]<500:
            pg.screenshot(path=str(OUT / "parceria_sucesso_celular.png"))
        overflow = pg.evaluate("document.documentElement.scrollWidth>window.innerWidth")
        check(tag+" sem rolagem horizontal", not overflow)
        check(tag+" sem erros JS", not errs, errs)
        b.close()

        # ---------- modo demonstração (sem Supabase configurado)
        b,pg,errs=setup(p,vp,configure=False)
        pg.locator("[data-open-b2b]:visible").first.click(); pg.wait_for_timeout(400)
        fill_all(pg); pg.click("#pfNext"); pg.wait_for_timeout(400)
        check(tag+" modo demonstração conclui e avisa", pg.evaluate("CMMD.Partnership.step")=="done" and pg.is_visible("#pfDemoNote"))
        # funcionalidades antigas continuam
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
        pg.click("#carouselNext"); pg.wait_for_timeout(300)
        check(tag+" carrossel continua funcionando", pg.evaluate("CMMD.Carousel.index")==1)
        pg.click("#p2pToggle"); pg.wait_for_timeout(300)
        check(tag+" P2P continua funcionando", pg.get_attribute("#p2pToggle","aria-expanded")=="true")
        check(tag+" (demo) sem erros JS", not errs, errs)
        b.close()

    # screenshots do modal (desktop e celular)
    for vp,name in [((1366,900),"pf_desktop.png"),((390,844),"pf_mobile.png")]:
        b,pg,errs=setup(p,vp)
        pg.locator("[data-open-b2b]:visible").first.click(); pg.wait_for_timeout(500)
        pg.screenshot(path=str(OUT / name)); b.close()

json.dump(captured, open(OUT / "payloads-formulario.json","w"), ensure_ascii=False, indent=1)
fails=[n for n,ok in results if not ok]
print(f"\n{len(results)-len(fails)}/{len(results)} testes passaram"); sys.exit(1 if fails else 0)
