export function renderTemplate(template: string, vars: Record<string, any> = {}) {
  if (!template) return '';
  // Simple handlebars-like replacement for {{key}}
  return template.replace(/{{\s*([a-zA-Z0-9_.]+)\s*}}/g, (_, key) => {
    const parts = key.split('.');
    let value: any = vars;
    for (const p of parts) {
      if (value == null) return '';
      value = value[p];
    }
    if (value == null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

export function renderSubjectAndBody(templateObj: { subject?: string; body?: string }, vars: Record<string, any> = {}) {
  return {
    subject: renderTemplate(templateObj.subject || '', vars),
    body: renderTemplate(templateObj.body || '', vars),
  };
}
