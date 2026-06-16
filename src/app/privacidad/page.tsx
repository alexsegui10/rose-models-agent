export const metadata = {
  title: "Política de Privacidad — Rose Models",
  description: "Cómo trata Rose Models los datos de las candidatas que contactan por Instagram."
};

// Página estática de política de privacidad. Meta la exige (URL pública) para pasar la app a modo
// Live y para el App Review. Texto en español, editable. Sustituye el correo de contacto por el real.
export default function PrivacidadPage() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 20px", lineHeight: 1.6, color: "#dbe4ec" }}>
      <h1>Política de Privacidad — Rose Models</h1>
      <p>Última actualización: junio de 2026</p>

      <h2>Quiénes somos</h2>
      <p>
        Rose Models es una agencia de representación de creadoras de contenido. Esta política explica cómo tratamos los datos de
        las personas que nos contactan por mensaje directo de Instagram.
      </p>

      <h2>Qué datos tratamos</h2>
      <ul>
        <li>Los mensajes que nos envías por Instagram y el identificador de tu cuenta.</li>
        <li>
          La información que compartes voluntariamente durante la conversación (por ejemplo: nombre, edad, país, disponibilidad y
          datos relevantes para valorar si encajas en la agencia).
        </li>
        <li>El número de teléfono/WhatsApp que nos facilites para coordinar una llamada, si así lo decides.</li>
      </ul>

      <h2>Para qué los usamos</h2>
      <p>
        Únicamente para atender tu interés y valorar si encajas en la agencia: responder a tus mensajes, cualificar tu perfil y,
        si procede, agendar una llamada. Un asistente automatizado, supervisado por el equipo de Rose Models, ayuda a gestionar
        las conversaciones. No usamos tus datos para fines distintos ni los vendemos.
      </p>

      <h2>Con quién los compartimos</h2>
      <p>
        Para entender y redactar las respuestas utilizamos un proveedor de modelos de lenguaje (OpenAI), que procesa el texto de
        la conversación. Los datos se almacenan en una base de datos segura con acceso restringido. No compartimos tus datos con
        terceros ajenos a la prestación del servicio.
      </p>

      <h2>Menores de edad</h2>
      <p>
        Solo trabajamos con personas mayores de 18 años. Si detectamos que una persona es menor de edad, la conversación se cierra
        y no se continúa el proceso.
      </p>

      <h2>Conservación</h2>
      <p>
        Conservamos los datos el tiempo necesario para gestionar tu candidatura. Puedes pedir su eliminación en cualquier momento
        (ver abajo).
      </p>

      <h2>Tus derechos</h2>
      <p>
        Puedes solicitar acceder, rectificar o eliminar tus datos, u oponerte a su tratamiento. Para ejercerlos, o para solicitar
        la <strong>eliminación de tus datos</strong>, escríbenos por mensaje directo a la cuenta de Instagram de Rose Models
        (@rosemodels_ofm) o al correo de contacto que figura más abajo, indicando tu usuario de Instagram. Atenderemos tu
        solicitud lo antes posible.
      </p>

      <h2>Contacto</h2>
      <p>Rose Models — Instagram: @rosemodels_ofm · Correo de contacto: rosemodels.ofm@gmail.com</p>
    </main>
  );
}
