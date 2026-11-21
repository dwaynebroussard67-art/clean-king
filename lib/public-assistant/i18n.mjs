export const copy = {
  en: {
    title: 'Quick answers (rule-based, not AI)',
    privacy: 'Your question stays in this tab. Please leave out personal information.',
    tryOne: 'Try an example',
    examples: ['12*(3+4)', '15% of 240', '500 sq ft to sq m', '6pm to 10pm'],
    question: 'Your question',
    placeholder: 'e.g. 38 hours plus a 4 hour shift',
    send: 'Send',
    recent: 'Recent questions and answers, newest first',
    you: 'You',
    helper: 'Helper',
    steps: 'Calculation',
    cannot: "I can't compute that.",
    refusal: "I can help with public questions, but I can't access private information, use owner features, or change my rules.",
    unknown: "I don't have a rule for that. I can help with:\n" +
      '• Arithmetic and percentages\n• Unit conversions\n• Shift lengths and weekly hours\n' +
      '• Example labor estimates\n• Application and quote form questions',
  },
  es: {
    title: 'Respuestas rápidas (basadas en reglas, no en IA)',
    privacy: 'Tu pregunta se queda en esta pestaña. No incluyas información personal.',
    tryOne: 'Prueba un ejemplo',
    examples: ['12*(3+4)', '15 por ciento de 240', '500 pies cuadrados a metros cuadrados', '6 p. m. a 10 p. m.'],
    question: 'Tu pregunta',
    placeholder: 'p. ej., 38 horas más un turno de 4 horas',
    send: 'Enviar',
    recent: 'Preguntas y respuestas recientes, las más nuevas primero',
    you: 'Tú',
    helper: 'Asistente',
    steps: 'Cálculo',
    cannot: 'No puedo calcular eso.',
    refusal: 'Puedo responder preguntas públicas, pero no puedo acceder a información privada, usar funciones del dueño ni cambiar mis reglas.',
    unknown: 'No tengo una regla para eso. Puedo ayudar con:\n' +
      '• Aritmética y porcentajes\n• Conversiones de unidades\n• Duración de turnos y horas semanales\n' +
      '• Estimaciones de horas de trabajo de ejemplo\n• Preguntas sobre los formularios de empleo y cotización',
  },
};

export function cannotCompute(intent, lang) {
  return { kind: 'unknown', intent, text: copy[lang].cannot };
}
