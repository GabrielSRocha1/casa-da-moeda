/** Template do e-mail de confirmação (PT-BR), com versão HTML e texto puro. */
export function emailCodeTemplate(code: string, ttlMinutes: number): { subject: string; html: string; text: string } {
  const subject = `${code} é o seu código de confirmação — Casa da Moeda Master Digital`;

  const text = [
    'Casa da Moeda Master Digital',
    '',
    `Seu código de confirmação de e-mail é: ${code}`,
    '',
    `O código expira em ${ttlMinutes} minutos.`,
    'Se você não solicitou este código, ignore esta mensagem.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#0b1020;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1020;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#131a33;border-radius:16px;padding:32px;">
          <tr><td style="color:#ffffff;font-size:18px;font-weight:bold;padding-bottom:8px;">Casa da Moeda Master Digital</td></tr>
          <tr><td style="color:#c7cde9;font-size:14px;padding-bottom:24px;">Use o código abaixo para confirmar o seu e-mail:</td></tr>
          <tr><td align="center" style="padding-bottom:24px;">
            <div style="display:inline-block;background:#0b1020;border:1px solid #2b355f;border-radius:12px;padding:16px 32px;color:#ffffff;font-size:32px;font-weight:bold;letter-spacing:8px;">${code}</div>
          </td></tr>
          <tr><td style="color:#8a93b8;font-size:12px;line-height:1.6;">
            O código expira em ${ttlMinutes} minutos.<br/>
            Se você não solicitou este código, ignore esta mensagem — nenhuma ação é necessária.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
