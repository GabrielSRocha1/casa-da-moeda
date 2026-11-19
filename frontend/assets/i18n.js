/* =====================================================================
   i18n — Casa da Moeda Master Digital
   Tradução PT-BR / ES / EN para index.html e painel.html.

   Como funciona
   -------------
   • DICT: mapa de textos em PT (normalizados com espaço único) → { es, en }.
   • O "walker" percorre o DOM e traduz todo texto/atributo estático que
     exista no DICT, de forma reversível (mantém o PT como forma canônica).
   • Conteúdo gerado por JS durante a interação usa window.I18N.t(...).
   • Elementos marcados com [data-i18n-skip] (valores, números, dados do
     usuário) não são tocados pelo walker.
   ===================================================================== */
(function () {
  'use strict';

  var LANGS = ['pt', 'es', 'en'];
  var STORE_KEY = 'cmmd_lang';

  /* ---------------------------------------------------------------
     DICIONÁRIO — chave = texto original em PT (espaços normalizados)
     --------------------------------------------------------------- */
  var DICT = {
    /* ---- Cabeçalho / navegação ---- */
    'Painel': { es: 'Panel', en: 'Dashboard' },
    'Ativos nativos': { es: 'Activos nativos', en: 'Native assets' },
    'Mesa OTC': { es: 'Mesa OTC', en: 'OTC Desk' },
    'Para negócios': { es: 'Para negocios', en: 'For business' },
    'Aviso legal': { es: 'Aviso legal', en: 'Legal notice' },
    'Crie o Utility Token do seu Negócio': { es: 'Crea el Utility Token de tu Negocio', en: "Create your Business's Utility Token" },
    'Criar token': { es: 'Crear token', en: 'Create token' },
    'Navegação principal': { es: 'Navegación principal', en: 'Main navigation' },
    'Casa da Moeda Master Digital — início': { es: 'Casa da Moeda Master Digital — inicio', en: 'Casa da Moeda Master Digital — home' },

    /* ---- Hero ---- */
    'Utility Tokens da comunidade · Auto-custódia': { es: 'Utility Tokens de la comunidad · Autocustodia', en: 'Community Utility Tokens · Self-custody' },
    'A casa da moeda': { es: 'La casa de la moneda', en: 'The mint house' },
    'da sua comunidade': { es: 'de tu comunidad', en: 'of your community' },
    'Adquira os ativos nativos da plataforma na Mesa OTC, receba direto na sua Verum Wallet e crie o token de utilidade do seu negócio, evento, time ou ONG.': {
      es: 'Adquiere los activos nativos de la plataforma en la Mesa OTC, recíbelos directo en tu Verum Wallet y crea el token de utilidad de tu negocio, evento, equipo u ONG.',
      en: "Acquire the platform's native assets at the OTC Desk, receive them directly in your Verum Wallet and create the utility token for your business, event, team or NGO." },
    'Ver ativos nativos': { es: 'Ver activos nativos', en: 'View native assets' },
    'Painel de referência': { es: 'Panel de referencia', en: 'Reference panel' },
    'Atualização simulada ·': { es: 'Actualización simulada ·', en: 'Simulated update ·' },
    'agora': { es: 'ahora', en: 'now' },

    /* ---- Carrossel de ativos ---- */
    'Bode, Verum e Escoteiros': { es: 'Bode, Verum y Escoteiros', en: 'Bode, Verum and Escoteiros' },
    'Os três utility tokens que movimentam o ecossistema Casa da Moeda Master Digital.': {
      es: 'Los tres utility tokens que mueven el ecosistema Casa da Moeda Master Digital.',
      en: 'The three utility tokens that power the Casa da Moeda Master Digital ecosystem.' },
    'Ativo anterior': { es: 'Activo anterior', en: 'Previous asset' },
    'Próximo ativo': { es: 'Activo siguiente', en: 'Next asset' },
    'Selecionar ativo': { es: 'Seleccionar activo', en: 'Select asset' },
    'O token da resistência e da força do sertão. Usado em feiras, eventos e no comércio da comunidade.': {
      es: 'El token de la resistencia y la fuerza del sertón. Usado en ferias, eventos y en el comercio de la comunidad.',
      en: "The token of the backlands' resilience and strength. Used at fairs, events and in community commerce." },
    'Token de utilidade do ecossistema Verum: acesso a serviços, descontos e governança comunitária.': {
      es: 'Token de utilidad del ecosistema Verum: acceso a servicios, descuentos y gobernanza comunitaria.',
      en: 'Utility token of the Verum ecosystem: access to services, discounts and community governance.' },
    'Recompensa atividades educativas, ações sociais e projetos de grupos de jovens e voluntários.': {
      es: 'Recompensa actividades educativas, acciones sociales y proyectos de grupos de jóvenes y voluntarios.',
      en: 'Rewards educational activities, social actions and projects by youth and volunteer groups.' },
    'BDC · Utility Token': { es: 'BDC · Token de Utilidad', en: 'BDC · Utility Token' },
    'VRC · Utility Token': { es: 'VRC · Token de Utilidad', en: 'VRC · Utility Token' },
    'ESCT · Utility Token': { es: 'ESCT · Token de Utilidad', en: 'ESCT · Utility Token' },
    'Preço atual de referência (USD)': { es: 'Precio actual de referencia (USD)', en: 'Current reference price (USD)' },
    'Comprar Bode Coin': { es: 'Comprar Bode Coin', en: 'Buy Bode Coin' },
    'Comprar Verum Coin': { es: 'Comprar Verum Coin', en: 'Buy Verum Coin' },
    'Comprar Escoteiros Coin': { es: 'Comprar Escoteiros Coin', en: 'Buy Escoteiros Coin' },
    'Histórico de preço (24 h)': { es: 'Histórico de precio (24 h)', en: 'Price history (24h)' },
    'simulado': { es: 'simulado', en: 'simulated' },
    'ao vivo · Solana': { es: 'en vivo · Solana', en: 'live · Solana' },
    'Abertura': { es: 'Apertura', en: 'Open' },
    'Rede': { es: 'Red', en: 'Network' },
    'Movimentação on-chain': { es: 'Movimiento on-chain', en: 'On-chain activity' },
    'ver no Solscan ↗': { es: 'ver en Solscan ↗', en: 'view on Solscan ↗' },
    'ver no Solscan': { es: 'ver en Solscan', en: 'view on Solscan' },
    'Carregando transações…': { es: 'Cargando transacciones…', en: 'Loading transactions…' },
    'Sem transações recentes.': { es: 'Sin transacciones recientes.', en: 'No recent transactions.' },
    'RPC indisponível agora —': { es: 'RPC no disponible ahora —', en: 'RPC unavailable right now —' },
    'confirmada': { es: 'confirmada', en: 'confirmed' },
    'falhou': { es: 'falló', en: 'failed' },

    /* ---- Mesa OTC (formulário) ---- */
    'Mesa OTC — compre ativo': { es: 'Mesa OTC — compra activo', en: 'OTC Desk — buy asset' },
    'Receba direto na sua Verum Wallet': { es: 'Recibe directo en tu Verum Wallet', en: 'Receive directly in your Verum Wallet' },
    'Ativo': { es: 'Activo', en: 'Asset' },
    'Qual cripto você deseja?': { es: '¿Qué cripto deseas?', en: 'Which crypto do you want?' },
    'Ex.: ETH, BNB, MATIC...': { es: 'Ej.: ETH, BNB, MATIC...', en: 'E.g.: ETH, BNB, MATIC...' },
    'Valor da aquisição (BRL)': { es: 'Monto de adquisición (BRL)', en: 'Acquisition amount (BRL)' },
    'Mínimo R$ 20,00 · máximo R$ 50.000,00 por ordem.': { es: 'Mínimo R$ 20,00 · máximo R$ 50.000,00 por orden.', en: 'Minimum R$ 20.00 · maximum R$ 50,000.00 per order.' },
    'Valores rápidos': { es: 'Montos rápidos', en: 'Quick amounts' },
    'Endereço público da sua Verum Wallet': { es: 'Dirección pública de tu Verum Wallet', en: 'Your Verum Wallet public address' },
    'Cole aqui seu endereço público': { es: 'Pega aquí tu dirección pública', en: 'Paste your public address here' },
    'Colar': { es: 'Pegar', en: 'Paste' },
    'Auto-custódia exclusiva: os ativos vão direto para a sua carteira. Nunca informe sua frase-semente (seed phrase).': {
      es: 'Autocustodia exclusiva: los activos van directo a tu billetera. Nunca compartas tu frase semilla (seed phrase).',
      en: 'Exclusive self-custody: assets go straight to your wallet. Never share your seed phrase.' },
    'Cotação de referência': { es: 'Cotización de referencia', en: 'Reference quote' },
    'Taxa da Mesa OTC (1,5%)': { es: 'Comisión de la Mesa OTC (1,5%)', en: 'OTC Desk fee (1.5%)' },
    'Você recebe (estimado)': { es: 'Recibes (estimado)', en: 'You receive (estimated)' },
    'Confirmo que o endereço é da minha própria Verum Wallet e li o aviso: utility tokens não garantem lucro.': {
      es: 'Confirmo que la dirección es de mi propia Verum Wallet y leí el aviso: los utility tokens no garantizan ganancias.',
      en: 'I confirm the address is my own Verum Wallet and I have read the notice: utility tokens do not guarantee profit.' },
    'Realizar Pagamento OTC': { es: 'Realizar Pago OTC', en: 'Make OTC Payment' },
    'Definida pela Mesa OTC': { es: 'Definida por la Mesa OTC', en: 'Set by the OTC Desk' },
    'A confirmar': { es: 'A confirmar', en: 'To be confirmed' },
    'A confirmar pelo vendedor': { es: 'A confirmar por el vendedor', en: 'To be confirmed by the seller' },

    /* ---- Seção B2B ---- */
    'Parcerias institucionais': { es: 'Alianzas institucionales', en: 'Institutional partnerships' },
    'Empresas, eventos, times, igrejas, clubes, fraternidades e ONGs podem ter o próprio token de utilidade. Você envia os dados da instituição, nossa equipe avalia o projeto e agenda um alinhamento com o responsável.': {
      es: 'Empresas, eventos, equipos, iglesias, clubes, fraternidades y ONGs pueden tener su propio token de utilidad. Envías los datos de la institución, nuestro equipo evalúa el proyecto y agenda una reunión con el responsable.',
      en: "Companies, events, teams, churches, clubs, fraternities and NGOs can have their own utility token. You submit the institution's details, our team reviews the project and schedules a meeting with the person in charge." },
    'Envie a solicitação': { es: 'Envía la solicitud', en: 'Submit the request' },
    'Dados da instituição e do responsável.': { es: 'Datos de la institución y del responsable.', en: 'Institution and contact details.' },
    'Avaliação da equipe': { es: 'Evaluación del equipo', en: 'Team review' },
    'Analisamos a utilidade e a viabilidade.': { es: 'Analizamos la utilidad y la viabilidad.', en: 'We assess the utility and feasibility.' },
    'Reunião de alinhamento': { es: 'Reunión de alineación', en: 'Alignment meeting' },
    'No dia e horário que você indicar.': { es: 'El día y horario que indiques.', en: 'On the day and time you choose.' },
    'Escolha o ramo da sua instituição:': { es: 'Elige el rubro de tu institución:', en: "Choose your institution's sector:" },

    /* ---- Rodapé ---- */
    'Plataforma comunitária de utility tokens com auto-custódia.': { es: 'Plataforma comunitaria de utility tokens con autocustodia.', en: 'Community utility-token platform with self-custody.' },
    'Aviso importante: O investimento em ativos digitais oferecidos nesta plataforma não garante lucro. Os ativos listados são estritamente Utility Tokens (tokens de utilidade), não possuindo valor imobiliário, mobiliário ou de garantia financeira. Sua finalidade é exclusivamente educacional, comunitária e de uso interno no ecossistema. A valorização ou flutuação do ativo depende exclusivamente do engajamento e comprimento da comunidade.': {
      es: 'Aviso importante: La inversión en activos digitales ofrecidos en esta plataforma no garantiza ganancias. Los activos listados son estrictamente Utility Tokens (tokens de utilidad), sin valor inmobiliario, mobiliario ni de garantía financiera. Su finalidad es exclusivamente educativa, comunitaria y de uso interno en el ecosistema. La valorización o fluctuación del activo depende exclusivamente del compromiso y la participación de la comunidad.',
      en: "Important notice: Investing in the digital assets offered on this platform does not guarantee profit. The listed assets are strictly Utility Tokens, with no real-estate, securities or financial-guarantee value. Their purpose is exclusively educational, community-based and for internal use within the ecosystem. The asset's appreciation or fluctuation depends solely on the community's engagement and commitment." },

    /* ---- Modal de pagamento ---- */
    'Pagamento OTC via Pix': { es: 'Pago OTC vía Pix', en: 'OTC Payment via Pix' },
    'Ordem': { es: 'Orden', en: 'Order' },
    'AMBIENTE DE SIMULAÇÃO — nenhum valor real é cobrado ou transferido.': { es: 'ENTORNO DE SIMULACIÓN — no se cobra ni transfiere ningún valor real.', en: 'SIMULATION ENVIRONMENT — no real funds are charged or transferred.' },
    'Expira em': { es: 'Expira en', en: 'Expires in' },
    'Pix copia e cola (simulado)': { es: 'Pix copia y pega (simulado)', en: 'Pix copy-and-paste (simulated)' },
    'Copiar': { es: 'Copiar', en: 'Copy' },
    'Enviado para sua Verum Wallet': { es: 'Enviado a tu Verum Wallet', en: 'Sent to your Verum Wallet' },
    'Transação simulada:': { es: 'Transacción simulada:', en: 'Simulated transaction:' },
    'Valor': { es: 'Monto', en: 'Amount' },
    'Recebe (est.)': { es: 'Recibe (est.)', en: 'Receives (est.)' },
    'Destino': { es: 'Destino', en: 'Destination' },
    'Cancelar ordem': { es: 'Cancelar orden', en: 'Cancel order' },
    'Simular pagamento': { es: 'Simular pago', en: 'Simulate payment' },
    'QR Code Pix simulado': { es: 'Código QR Pix simulado', en: 'Simulated Pix QR code' },
    'Aguardando': { es: 'En espera', en: 'Pending' },
    'Confirmado': { es: 'Confirmado', en: 'Confirmed' },
    'Enviando': { es: 'Enviando', en: 'Sending' },
    'Concluído': { es: 'Completado', en: 'Completed' },
    'Processando…': { es: 'Procesando…', en: 'Processing…' },
    'Concluir': { es: 'Finalizar', en: 'Finish' },
    'SIMULAÇÃO': { es: 'SIMULACIÓN', en: 'SIMULATION' },
    'Ordem expirada. Gere uma nova ordem.': { es: 'Orden expirada. Genera una nueva orden.', en: 'Order expired. Create a new order.' },
    'Código copiado.': { es: 'Código copiado.', en: 'Code copied.' },
    'Selecione e copie o código manualmente.': { es: 'Selecciona y copia el código manualmente.', en: 'Select and copy the code manually.' },
    'Pagamento Pix confirmado (simulado).': { es: 'Pago Pix confirmado (simulado).', en: 'Pix payment confirmed (simulated).' },
    'Enviando ativos para sua Verum Wallet…': { es: 'Enviando activos a tu Verum Wallet…', en: 'Sending assets to your Verum Wallet…' },
    'Concluído! Ativos enviados para sua Verum Wallet (simulado).': { es: '¡Completado! Activos enviados a tu Verum Wallet (simulado).', en: 'Done! Assets sent to your Verum Wallet (simulated).' },
    'Ordem cancelada.': { es: 'Orden cancelada.', en: 'Order cancelled.' },
    'Não foi possível acessar a área de transferência. Cole manualmente (Ctrl+V).': { es: 'No se pudo acceder al portapapeles. Pega manualmente (Ctrl+V).', en: "Couldn't access the clipboard. Paste manually (Ctrl+V)." },
    '{asset} selecionado. Informe o valor e sua Verum Wallet.': { es: '{asset} seleccionado. Indica el monto y tu Verum Wallet.', en: '{asset} selected. Enter the amount and your Verum Wallet.' },
    'Revise os campos destacados.': { es: 'Revisa los campos resaltados.', en: 'Review the highlighted fields.' },

    /* ---- Validação Mesa OTC ---- */
    'Informe qual cripto você deseja comprar.': { es: 'Indica qué cripto deseas comprar.', en: 'Specify which crypto you want to buy.' },
    'Informe o valor do investimento.': { es: 'Indica el monto de la inversión.', en: 'Enter the investment amount.' },
    'O valor mínimo é {v}.': { es: 'El monto mínimo es {v}.', en: 'The minimum amount is {v}.' },
    'O valor máximo por ordem é {v}.': { es: 'El monto máximo por orden es {v}.', en: 'The maximum amount per order is {v}.' },
    'Cole o endereço público da sua Verum Wallet.': { es: 'Pega la dirección pública de tu Verum Wallet.', en: 'Paste your Verum Wallet public address.' },
    'Isso parece uma frase-semente! Nunca compartilhe sua seed phrase. Cole apenas o endereço público.': { es: '¡Esto parece una frase semilla! Nunca compartas tu seed phrase. Pega solo la dirección pública.', en: 'That looks like a seed phrase! Never share your seed phrase. Paste only the public address.' },
    'Endereço inválido. Use o endereço público da Verum Wallet (Solana base58 ou EVM 0x…).': { es: 'Dirección inválida. Usa la dirección pública de la Verum Wallet (Solana base58 o EVM 0x…).', en: 'Invalid address. Use your Verum Wallet public address (Solana base58 or EVM 0x…).' },
    'Confirme a auto-custódia e a leitura do aviso.': { es: 'Confirma la autocustodia y la lectura del aviso.', en: "Confirm self-custody and that you've read the notice." },

    /* ---- Modal B2B / cabeçalho ---- */
    'Solicitação de Parceria': { es: 'Solicitud de Alianza', en: 'Partnership Request' },
    'Envie os dados da sua instituição. Nossa equipe avalia e entra em contato para o alinhamento.': {
      es: 'Envía los datos de tu institución. Nuestro equipo evalúa y se pone en contacto para la reunión.',
      en: "Submit your institution's details. Our team reviews and gets in touch to align." },
    'Por que tokenizar sua instituição na Casa da Moeda Master Digital?': { es: '¿Por qué tokenizar tu institución en Casa da Moeda Master Digital?', en: 'Why tokenize your institution with Casa da Moeda Master Digital?' },
    'Ecossistema Crypto Master Digital': { es: 'Ecosistema Crypto Master Digital', en: 'Crypto Master Digital Ecosystem' },
    'Suporte técnico e respaldo estratégico.': { es: 'Soporte técnico y respaldo estratégico.', en: 'Technical support and strategic backing.' },
    'Integração com a Verum Wallet': { es: 'Integración con la Verum Wallet', en: 'Verum Wallet integration' },
    'Entrega direta dos ativos em carteiras de auto-custódia dos usuários.': { es: 'Entrega directa de los activos en billeteras de autocustodia de los usuarios.', en: "Direct delivery of assets to users' self-custody wallets." },
    'Ecossistema Global Pay': { es: 'Ecosistema Global Pay', en: 'Global Pay Ecosystem' },
    'Soluções de pagamento integradas para utilidade real do token.': { es: 'Soluciones de pago integradas para una utilidad real del token.', en: 'Integrated payment solutions for real token utility.' },
    'Esta é uma solicitação de parceria: o token é estruturado junto com a nossa equipe, após avaliação.': {
      es: 'Esta es una solicitud de alianza: el token se estructura junto con nuestro equipo, tras la evaluación.',
      en: 'This is a partnership request: the token is structured together with our team, after review.' },

    /* ---- Formulário B2B ---- */
    '1. Dados da Instituição / Empresa': { es: '1. Datos de la Institución / Empresa', en: '1. Institution / Company Details' },
    'Campos com': { es: 'Campos con', en: 'Fields marked with' },
    'são obrigatórios.': { es: 'son obligatorios.', en: 'are required.' },
    'Nome da Empresa / Instituição': { es: 'Nombre de la Empresa / Institución', en: 'Company / Institution Name' },
    'Ex.: Associação Cultural Vale do Sol': { es: 'Ej.: Asociación Cultural Valle del Sol', en: 'E.g.: Vale do Sol Cultural Association' },
    'Endereço completo da empresa': { es: 'Dirección completa de la empresa', en: "Company's full address" },
    'Rua, número, bairro, cidade, estado/departamento, CEP e país': { es: 'Calle, número, barrio, ciudad, estado/departamento, código postal y país', en: 'Street, number, neighborhood, city, state/department, postal code and country' },
    'Ramo de Atuação': { es: 'Rubro de Actividad', en: 'Business Sector' },
    'Selecione…': { es: 'Selecciona…', en: 'Select…' },
    'Qual ramo?': { es: '¿Qué rubro?', en: 'Which sector?' },
    'Ex.: Cooperativa agrícola': { es: 'Ej.: Cooperativa agrícola', en: 'E.g.: Agricultural cooperative' },
    'Breve descrição da instituição e do ramo em que atua': { es: 'Breve descripción de la institución y del rubro en que actúa', en: 'Brief description of the institution and its sector' },
    'O que a instituição faz, para quem, há quanto tempo e como imagina usar um token de utilidade.': { es: 'Qué hace la institución, para quién, desde hace cuánto y cómo imagina usar un token de utilidad.', en: 'What the institution does, for whom, for how long and how it envisions using a utility token.' },
    'Mínimo de 30 caracteres.': { es: 'Mínimo 30 caracteres.', en: 'Minimum 30 characters.' },
    '2. Dados do Tomador de Decisão': { es: '2. Datos del Tomador de Decisión', en: '2. Decision-Maker Details' },
    'Diretor(a) ou responsável que decide pela instituição.': { es: 'Director(a) o responsable que decide por la institución.', en: 'Director or person who decides for the institution.' },
    'Nome completo do Diretor / Responsável': { es: 'Nombre completo del Director / Responsable', en: 'Full name of the Director / Contact' },
    'Nome e sobrenome': { es: 'Nombre y apellido', en: 'First and last name' },
    'WhatsApp de contato direto': { es: 'WhatsApp de contacto directo', en: 'Direct contact WhatsApp' },
    'Código do país do WhatsApp': { es: 'Código de país del WhatsApp', en: 'WhatsApp country code' },
    'Telefone fixo / celular alternativo': { es: 'Teléfono fijo / celular alternativo', en: 'Landline / alternative mobile' },
    'Código do país do telefone alternativo': { es: 'Código de país del teléfono alternativo', en: 'Alternative phone country code' },
    'Opcional': { es: 'Opcional', en: 'Optional' },
    'E-mail corporativo / pessoal': { es: 'Correo corporativo / personal', en: 'Corporate / personal email' },
    'Você precisa de mais alguém para a permissão da criação?': { es: '¿Necesitas a alguien más para autorizar la creación?', en: 'Do you need anyone else to approve the creation?' },
    'Não — eu mesmo(a) autorizo a criação': { es: 'No — yo mismo(a) autorizo la creación', en: 'No — I authorize the creation myself' },
    'Sim — preciso de mais alguém para autorizar': { es: 'Sí — necesito a alguien más para autorizar', en: 'Yes — I need someone else to approve' },
    'Quem é a pessoa que precisa autorizar?': { es: '¿Quién es la persona que debe autorizar?', en: 'Who is the person who must approve?' },
    'Nome completo e cargo — ex.: Ana Lima, Presidente do Conselho': { es: 'Nombre completo y cargo — ej.: Ana Lima, Presidenta del Consejo', en: 'Full name and role — e.g.: Ana Lima, Board Chair' },
    '3. Disponibilidade para Alinhamento': { es: '3. Disponibilidad para la Reunión', en: '3. Availability for the Meeting' },
    'Quando nossa equipe pode falar com o responsável?': { es: '¿Cuándo puede nuestro equipo hablar con el responsable?', en: 'When can our team talk to the contact?' },
    'Dias da semana de preferência': { es: 'Días de la semana de preferencia', en: 'Preferred weekdays' },
    'Segunda a Sexta': { es: 'Lunes a Viernes', en: 'Monday to Friday' },
    'Todos': { es: 'Todos', en: 'All' },
    'Horários disponíveis para contato/reunião': { es: 'Horarios disponibles para contacto/reunión', en: 'Available times for contact/meeting' },
    'Faixa de horário específica': { es: 'Rango de horario específico', en: 'Specific time range' },
    '(opcional)': { es: '(opcional)', en: '(optional)' },
    'Das': { es: 'Desde', en: 'From' },
    'Até': { es: 'Hasta', en: 'To' },
    'Fuso horário': { es: 'Zona horaria', en: 'Time zone' },
    'Autorizo a Casa da Moeda Master Digital a usar estes dados exclusivamente para avaliar a parceria e entrar em contato pelos canais informados (LGPD).': {
      es: 'Autorizo a Casa da Moeda Master Digital a usar estos datos exclusivamente para evaluar la alianza y contactarme por los canales informados (protección de datos).',
      en: 'I authorize Casa da Moeda Master Digital to use this data solely to assess the partnership and contact me through the channels provided (data protection).' },
    'Solicitação enviada com sucesso!': { es: '¡Solicitud enviada con éxito!', en: 'Request submitted successfully!' },
    'Protocolo': { es: 'Protocolo', en: 'Reference' },
    'Cancelar': { es: 'Cancelar', en: 'Cancel' },
    'Continuar': { es: 'Continuar', en: 'Continue' },
    'Voltar': { es: 'Volver', en: 'Back' },
    'Enviar Solicitação de Parceria': { es: 'Enviar Solicitud de Alianza', en: 'Submit Partnership Request' },
    'Fechar': { es: 'Cerrar', en: 'Close' },
    'Enviando…': { es: 'Enviando…', en: 'Sending…' },
    'Etapas do cadastro': { es: 'Etapas del registro', en: 'Form steps' },
    'Instituição': { es: 'Institución', en: 'Institution' },
    'Responsável': { es: 'Responsable', en: 'Contact' },
    'Disponibilidade': { es: 'Disponibilidad', en: 'Availability' },
    'Revise os campos destacados em vermelho.': { es: 'Revisa los campos resaltados en rojo.', en: 'Review the fields highlighted in red.' },
    'Solicitação de parceria enviada!': { es: '¡Solicitud de alianza enviada!', en: 'Partnership request sent!' },

    /* ---- Validação do formulário B2B ---- */
    'Informe o nome da empresa ou instituição.': { es: 'Indica el nombre de la empresa o institución.', en: 'Enter the company or institution name.' },
    'Informe o endereço completo (rua, número, cidade e estado).': { es: 'Indica la dirección completa (calle, número, ciudad y estado).', en: 'Enter the full address (street, number, city and state).' },
    'Selecione o ramo de atuação.': { es: 'Selecciona el rubro de actividad.', en: 'Select the business sector.' },
    'Descreva o ramo de atuação.': { es: 'Describe el rubro de actividad.', en: 'Describe the business sector.' },
    'Descreva a instituição com pelo menos 30 caracteres.': { es: 'Describe la institución con al menos 30 caracteres.', en: 'Describe the institution with at least 30 characters.' },
    'Informe nome e sobrenome do responsável.': { es: 'Indica nombre y apellido del responsable.', en: "Enter the contact's first and last name." },
    'Informe o WhatsApp de contato.': { es: 'Indica el WhatsApp de contacto.', en: 'Enter the contact WhatsApp.' },
    'WhatsApp inválido. Confira o DDD e o número.': { es: 'WhatsApp inválido. Verifica el código de área y el número.', en: 'Invalid WhatsApp. Check the area code and number.' },
    'Telefone inválido. Confira o número ou deixe em branco.': { es: 'Teléfono inválido. Verifica el número o déjalo en blanco.', en: 'Invalid phone. Check the number or leave it blank.' },
    'Informe um e-mail para contato.': { es: 'Indica un correo de contacto.', en: 'Enter a contact email.' },
    'E-mail inválido.': { es: 'Correo inválido.', en: 'Invalid email.' },
    'Informe se a criação depende de mais alguém.': { es: 'Indica si la creación depende de alguien más.', en: 'Specify whether the creation depends on someone else.' },
    'Informe quem é a pessoa que autoriza (nome e, se possível, cargo).': { es: 'Indica quién es la persona que autoriza (nombre y, si es posible, cargo).', en: 'Specify who approves (name and, if possible, role).' },
    'Selecione pelo menos um dia da semana.': { es: 'Selecciona al menos un día de la semana.', en: 'Select at least one weekday.' },
    'Selecione pelo menos um período.': { es: 'Selecciona al menos un período.', en: 'Select at least one time slot.' },
    'Preencha o horário inicial e o final, ou deixe ambos em branco.': { es: 'Completa el horario inicial y el final, o deja ambos en blanco.', en: 'Fill in both start and end times, or leave both blank.' },
    'O horário final deve ser depois do inicial.': { es: 'El horario final debe ser posterior al inicial.', en: 'The end time must be after the start time.' },
    'É necessário autorizar o contato para enviar a solicitação.': { es: 'Debes autorizar el contacto para enviar la solicitud.', en: 'You must authorize contact to submit the request.' },
    'Não foi possível conectar. Verifique sua internet e tente novamente — seus dados continuam preenchidos.': { es: 'No se pudo conectar. Verifica tu internet e inténtalo de nuevo — tus datos siguen guardados.', en: "Couldn't connect. Check your internet and try again — your data is still filled in." },
    'Já recebemos solicitações recentes com este e-mail ou WhatsApp. Nossa equipe entrará em contato em breve.': { es: 'Ya recibimos solicitudes recientes con este correo o WhatsApp. Nuestro equipo se pondrá en contacto pronto.', en: "We've already received recent requests with this email or WhatsApp. Our team will be in touch soon." },
    'Alguns dados não foram aceitos. Revise as informações e tente novamente.': { es: 'Algunos datos no fueron aceptados. Revisa la información e inténtalo de nuevo.', en: "Some data wasn't accepted. Review the information and try again." },
    'O envio está temporariamente indisponível. Tente novamente mais tarde.': { es: 'El envío está temporalmente no disponible. Inténtalo más tarde.', en: 'Submission is temporarily unavailable. Try again later.' },
    'Não foi possível enviar sua solicitação agora. Tente novamente em instantes.': { es: 'No se pudo enviar tu solicitud ahora. Inténtalo en unos instantes.', en: "Couldn't submit your request right now. Try again shortly." },
    'Modo demonstração: o Supabase ainda não foi configurado nesta página, então a solicitação ficou salva apenas neste navegador.': { es: 'Modo demostración: Supabase aún no está configurado en esta página, por lo que la solicitud se guardó solo en este navegador.', en: "Demo mode: Supabase isn't configured on this page yet, so the request was saved only in this browser." },

    /* ---- Ramos de atuação (rótulos exibidos; valor salvo permanece em PT) ---- */
    'Empresas e Negócios': { es: 'Empresas y Negocios', en: 'Companies & Business' },
    'Eventos e Festas Sertanejas': { es: 'Eventos y Fiestas Sertanejas', en: 'Events & Country Parties' },
    'Times de Futebol / Esportes': { es: 'Equipos de Fútbol / Deportes', en: 'Football / Sports Teams' },
    'Feiras Culturais': { es: 'Ferias Culturales', en: 'Cultural Fairs' },
    'Ajuda Humanitária / ONGs': { es: 'Ayuda Humanitaria / ONGs', en: 'Humanitarian Aid / NGOs' },
    'Igrejas e Instituições Religiosas': { es: 'Iglesias e Instituciones Religiosas', en: 'Churches & Religious Institutions' },
    'Clubes Recreativos': { es: 'Clubes Recreativos', en: 'Recreational Clubs' },
    'Fraternidades e Lojas': { es: 'Fraternidades y Logias', en: 'Fraternities & Lodges' },
    'Outros': { es: 'Otros', en: 'Other' },
    'Fidelidade, cashback e moeda interna.': { es: 'Fidelidad, cashback y moneda interna.', en: 'Loyalty, cashback and in-house currency.' },
    'Ingresso, consumo e votação de atrações.': { es: 'Entradas, consumo y votación de atracciones.', en: 'Tickets, purchases and act voting.' },
    'Sócio-torcedor, enquetes e benefícios.': { es: 'Socio-hincha, encuestas y beneficios.', en: 'Membership, polls and perks.' },
    'Moeda de feira para expositores e público.': { es: 'Moneda de feria para expositores y público.', en: 'Fair currency for exhibitors and visitors.' },
    'Rastreio de doações e voluntariado.': { es: 'Seguimiento de donaciones y voluntariado.', en: 'Donation and volunteering tracking.' },
    'Campanhas, eventos e ações sociais.': { es: 'Campañas, eventos y acciones sociales.', en: 'Campaigns, events and social actions.' },
    'Associados, bar, eventos e reservas.': { es: 'Socios, bar, eventos y reservas.', en: 'Members, bar, events and bookings.' },
    'Contribuições internas e eventos.': { es: 'Contribuciones internas y eventos.', en: 'Internal contributions and events.' },
    'Conte para nós o seu ramo.': { es: 'Cuéntanos tu rubro.', en: 'Tell us your sector.' },

    /* ---- Dias / períodos / fusos ---- */
    'Seg': { es: 'Lun', en: 'Mon' }, 'Ter': { es: 'Mar', en: 'Tue' }, 'Qua': { es: 'Mié', en: 'Wed' },
    'Qui': { es: 'Jue', en: 'Thu' }, 'Sex': { es: 'Vie', en: 'Fri' }, 'Sáb': { es: 'Sáb', en: 'Sat' }, 'Dom': { es: 'Dom', en: 'Sun' },
    'segunda': { es: 'lunes', en: 'Monday' }, 'terça': { es: 'martes', en: 'Tuesday' }, 'quarta': { es: 'miércoles', en: 'Wednesday' },
    'quinta': { es: 'jueves', en: 'Thursday' }, 'sexta': { es: 'viernes', en: 'Friday' }, 'sábado': { es: 'sábado', en: 'Saturday' }, 'domingo': { es: 'domingo', en: 'Sunday' },
    'Manhã': { es: 'Mañana', en: 'Morning' }, 'Tarde': { es: 'Tarde', en: 'Afternoon' }, 'Noite': { es: 'Noche', en: 'Evening' },
    '8h às 12h': { es: '8h a 12h', en: '8am–12pm' }, '12h às 18h': { es: '12h a 18h', en: '12pm–6pm' }, '18h às 21h': { es: '18h a 21h', en: '6pm–9pm' },
    'manhã (8h–12h)': { es: 'mañana (8h–12h)', en: 'morning (8am–12pm)' }, 'tarde (12h–18h)': { es: 'tarde (12h–18h)', en: 'afternoon (12pm–6pm)' }, 'noite (18h–21h)': { es: 'noche (18h–21h)', en: 'evening (6pm–9pm)' },
    'Paraguai (Assunção)': { es: 'Paraguay (Asunción)', en: 'Paraguay (Asunción)' },
    'Uruguai (Montevidéu)': { es: 'Uruguay (Montevideo)', en: 'Uruguay (Montevideo)' },

    /* ---- Texto de sucesso (modelos completos) ---- */
    'em qualquer dia da semana': { es: 'cualquier día de la semana', en: 'on any day of the week' },
    'de segunda a sexta-feira': { es: 'de lunes a viernes', en: 'Monday through Friday' },

    /* ---- Títulos / meta ---- */
    'Casa da Moeda Master Digital — Utility Tokens da Comunidade': { es: 'Casa da Moeda Master Digital — Utility Tokens de la Comunidad', en: 'Casa da Moeda Master Digital — Community Utility Tokens' },
    'Casa da Moeda Master Digital: compre Bode Coin, Verum Coin e Escoteiros Coin em P2P com auto-custódia na Verum Wallet e solicite a parceria para tokenizar sua instituição.': {
      es: 'Casa da Moeda Master Digital: compra Bode Coin, Verum Coin y Escoteiros Coin en P2P con autocustodia en la Verum Wallet y solicita la alianza para tokenizar tu institución.',
      en: 'Casa da Moeda Master Digital: buy Bode Coin, Verum Coin and Escoteiros Coin P2P with Verum Wallet self-custody, and request a partnership to tokenize your institution.' },

    /* ---- Painel de ativos (página painel.html) ---- */
    'Painel de Ativos — Casa da Moeda Master Digital': { es: 'Panel de Activos — Casa da Moeda Master Digital', en: 'Asset Dashboard — Casa da Moeda Master Digital' },
    'Painel com os ativos nativos da Casa da Moeda Master Digital: preço em tempo real, variação 24h e acesso direto à Mesa OTC.': {
      es: 'Panel con los activos nativos de Casa da Moeda Master Digital: precio en tiempo real, variación 24h y acceso directo a la Mesa OTC.',
      en: "Dashboard with Casa da Moeda Master Digital's native assets: real-time price, 24h change and direct access to the OTC Desk." },
    'Voltar para o início': { es: 'Volver al inicio', en: 'Back to home' },
    'Painel de Ativos': { es: 'Panel de Activos', en: 'Asset Dashboard' },
    'Navegação': { es: 'Navegación', en: 'Navigation' },
    'Início': { es: 'Inicio', en: 'Home' },
    'Preços reais · Solana mainnet': { es: 'Precios reales · Solana mainnet', en: 'Real prices · Solana mainnet' },
    'Cotação em tempo real dos tokens nativos. Clique em um ativo para negociar na': { es: 'Cotización en tiempo real de los tokens nativos. Haz clic en un activo para negociar en la', en: 'Real-time quotes for the native tokens. Click an asset to trade on the' },
    'carregando…': { es: 'cargando…', en: 'loading…' },
    'Negociar {asset} na Mesa OTC': { es: 'Negociar {asset} en la Mesa OTC', en: 'Trade {asset} on the OTC Desk' },
    'última tx {ago}': { es: 'última tx {ago}', en: 'last tx {ago}' },
    'sem tx recente': { es: 'sin tx reciente', en: 'no recent tx' },
    'on-chain': { es: 'on-chain', en: 'on-chain' }
  };

  /* ---------------------------------------------------------------
     Índice reverso (tradução → PT) para alternância reversível.
     --------------------------------------------------------------- */
  var REV = { es: {}, en: {} };
  for (var pt in DICT) {
    if (!DICT.hasOwnProperty(pt)) continue;
    var e = DICT[pt];
    if (e.es && !(e.es in REV.es)) REV.es[e.es] = pt;
    if (e.en && !(e.en in REV.en)) REV.en[e.en] = pt;
  }

  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  function storedLang() {
    try { var v = localStorage.getItem(STORE_KEY); if (LANGS.indexOf(v) >= 0) return v; } catch (e) {}
    return 'pt';
  }

  var current = storedLang();
  var listeners = [];

  function toPt(coreKey) {
    if (current === 'pt') return coreKey;
    return REV[current][coreKey] || coreKey;
  }
  function fromPt(ptKey, target) {
    if (target === 'pt') return ptKey;
    var ent = DICT[ptKey];
    return (ent && ent[target]) || ptKey;
  }
  function retranslate(text, target) {
    return fromPt(toPt(norm(text)), target);
  }

  /** t(): usado pelo JS para textos gerados dinamicamente. */
  function t(key, vars) {
    var out = fromPt(norm(key), current);
    if (vars) out = out.replace(/\{(\w+)\}/g, function (m, k) { return (k in vars) ? vars[k] : m; });
    return out;
  }

  var ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1 };

  function inSkip(node) {
    var el = node.nodeType === 3 ? node.parentElement : node;
    while (el) {
      if (el.nodeType === 1) {
        if (el.hasAttribute('data-i18n-skip')) return true;
        if (el.classList && el.classList.contains('lang-switch')) return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  function applyTo(target) {
    if (!document.body) return;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (n.parentNode && SKIP_TAGS[n.parentNode.nodeName]) return NodeFilter.FILTER_REJECT;
        if (inSkip(n)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }, false);
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      var raw = node.nodeValue;
      var lead = raw.match(/^\s*/)[0];
      var trail = raw.match(/\s*$/)[0];
      var core = raw.trim();
      if (!core) return;
      var tr = retranslate(core, target);
      if (tr !== core) node.nodeValue = lead + tr + trail;
    });

    var els = document.body.querySelectorAll('[placeholder],[aria-label],[title],[alt]');
    Array.prototype.forEach.call(els, function (el) {
      if (inSkip(el)) return;
      ATTRS.forEach(function (a) {
        if (!el.hasAttribute(a)) return;
        var v = el.getAttribute(a);
        if (!v || !v.trim()) return;
        var tr = retranslate(v, target);
        if (tr !== v) el.setAttribute(a, tr);
      });
    });

    if (document.title) {
      var tt = retranslate(document.title, target);
      if (tt !== document.title) document.title = tt;
    }
    var md = document.querySelector('meta[name="description"]');
    if (md) {
      var dv = md.getAttribute('content') || '';
      var dt = retranslate(dv, target);
      if (dt !== dv) md.setAttribute('content', dt);
    }
  }

  function setHtmlLang(l) {
    document.documentElement.lang = l === 'pt' ? 'pt-BR' : l;
  }

  function set(lang) {
    if (LANGS.indexOf(lang) < 0 || lang === current) return;
    applyTo(lang);            // traduz o DOM do idioma atual → novo idioma
    current = lang;
    try { localStorage.setItem(STORE_KEY, lang); } catch (e) {}
    setHtmlLang(lang);
    updateSwitcher();
    listeners.forEach(function (cb) { try { cb(lang); } catch (e) {} });
  }

  /** Traduz o DOM estático para o idioma atual (chamado na carga da página). */
  function apply() { if (current !== 'pt') applyTo(current); setHtmlLang(current); }

  function onChange(cb) { if (typeof cb === 'function') listeners.push(cb); }

  /* ---------------------------------------------------------------
     Seletor de idiomas (injetado em qualquer .lang-switch)
     --------------------------------------------------------------- */
  var NAMES = { pt: 'PT', es: 'ES', en: 'EN' };
  var FULL = { pt: 'Português', es: 'Español', en: 'English' };

  function buildSwitcher() {
    var hosts = document.querySelectorAll('.lang-switch');
    Array.prototype.forEach.call(hosts, function (host) {
      host.innerHTML = '';
      host.setAttribute('role', 'group');
      host.setAttribute('aria-label', 'Idioma / Language');
      LANGS.forEach(function (l) {
        var b = document.createElement('button');
        b.type = 'button';
        b.dataset.lang = l;
        b.textContent = NAMES[l];
        b.title = FULL[l];
        b.setAttribute('aria-label', FULL[l]);
        b.className = 'cmmd-lang-btn';
        b.addEventListener('click', function () { set(l); });
        host.appendChild(b);
      });
    });
    updateSwitcher();
  }

  function updateSwitcher() {
    var btns = document.querySelectorAll('.lang-switch .cmmd-lang-btn');
    Array.prototype.forEach.call(btns, function (b) {
      var on = b.dataset.lang === current;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  window.I18N = {
    t: t,
    apply: apply,
    set: set,
    onChange: onChange,
    get lang() { return current; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildSwitcher);
  } else {
    buildSwitcher();
  }
})();
