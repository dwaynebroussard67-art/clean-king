import { copy } from './i18n.mjs';

// These checks classify questions for a polite reply; there is no private data source.
const restricted = [
  /\b(?:private|personal|confidential|passwords?|passcodes?|credentials?|secrets?|api[- ]keys?|ssn|social security)\b/,
  /\b(?:phones?|address(?:es)?|e-?mails?|payroll|rosters?|medical records?|patient records?)\b/,
  /\b(?:other people|someone else's|another person's|coworker's|who applied|who works at)\b/,
  /\b(?:list of|show (?:me )?all|names of) (?:the )?(?:applicants|workers|customers|students|patients)\b/,
  /\b(?:applicant|employee|customer|student|crew|patient) (?:names?|lists?|records?|details|schedules?)\b/,
  /\b(?:owner(?:'s)?[- ](?:only|mode|dashboard|settings|access|features?|assistant)|admin|impersonate|act as|pretend to be)\b/,
  /\b(?:privad[oa]s?|personales|confidencial(?:es)?|contrasenas?|credenciales|claves?|telefonos?|correos?|nomina)\b/,
  /\b(?:otra persona|otras personas|de otros|de otras|modo dueno|modo propietario|actuar? como|finge ser)\b/,
  /\b(?:nombres?|datos|lista|expedientes?) de (?:los |las )?(?:empleados|solicitantes|clientes|alumnos|pacientes)\b/,
  /\b(?:panel|funciones|ajustes|modo) (?:solo )?(?:para el |del )(?:dueno|propietario|administrador)\b/,
  /\b(?:ignore|disregard|override|forget|bypass|ignora|omite|olvida)\b.*\b(?:instructions?|rules?|instrucciones|reglas)\b/,
];

// PLACEHOLDER — Andy must approve the FAQ wording. Do not supply business facts here.
const topics = [
  {
    intent: 'faq.confirm',
    patterns: [
      /\b(?:service areas?|where (?:do you|we) (?:work|clean)|do you serve|pric(?:e|es|ing)|rates?|costs?|how much do you charge)\b/,
      /\b(?:business hours|opening hours|your hours|hours of operation|when (?:are you|do you) open)\b|^hours$/,
      /\b(?:zonas? de servicio|areas? de servicio|zona de cobertura|donde (?:trabajan|limpian)|precios?|tarifas?|cuanto (?:cuesta|cobran))\b/,
      /\b(?:horarios?|horas de (?:atencion|apertura|operacion))\b|^horas$/,
    ],
    en: 'The owner will confirm this — please use the quote form: /quote',
    es: 'El dueño lo confirmará. Por favor, usa el formulario de cotización: /quote',
  },
  {
    intent: 'faq.quote', patterns: [/\b(?:quotes?|cotizaci(?:on|ones)|cotizar|presupuestos?)\b/],
    en: 'Open the quote request form: /quote', es: 'Abre el formulario de cotización: /quote',
  },
  {
    intent: 'faq.apply',
    patterns: [/\b(?:apply|application|applying|empleo|postular(?:me|se)?|solicit(?:ar|o) trabajo|solicitud de trabajo|aplic(?:ar|o))\b/],
    en: 'Open the application form: /apply', es: 'Abre el formulario de solicitud de empleo: /apply',
  },
  {
    intent: 'faq.languages', patterns: [/\b(?:languages?|idiomas?|speak spanish|hablas ingles)\b/],
    en: 'This helper works in English and Spanish.', es: 'Este asistente funciona en inglés y español.',
  },
  {
    intent: 'faq.help',
    patterns: [/\b(?:help|what can (?:you|this helper) do|what this helper can do|ayuda|que puedes hacer|que puede hacer|que haces)\b/],
    en: 'I can calculate, convert units, check hours, give example labor estimates, and point you to public forms.',
    es: 'Puedo calcular, convertir unidades, revisar horas, estimar horas de trabajo con ejemplos e indicar dónde están los formularios públicos.',
  },
];

export function faq(text, lang) {
  // Only unrestricted questions are eligible for keyword matching, even if they mention a form.
  if (restricted.some(rule => rule.test(text))) {
    return { kind: 'refusal', intent: null, text: copy[lang].refusal };
  }
  const topic = topics.find(({ patterns }) => patterns.some(rule => rule.test(text)));
  return topic ? { kind: 'answer', intent: topic.intent, text: topic[lang] } : null;
}
