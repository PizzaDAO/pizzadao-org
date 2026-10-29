export const title = 'Organiza una fiesta'
export const dek = 'Cómo hacer una fiesta de pizza de PizzaDAO: planéala, presupuéstala, anúnciala, hazla y recupera tus gastos.'
export const reviewed = '2026-10'

export const body = String.raw`
Cualquiera puede organizar una fiesta de PizzaDAO: unos amigos, una pizzería, un espacio comunitario. Esta página cubre todo el recorrido. Si eres nuevo, lee primero [primeros pasos](/handbook/getting-started) y entra a una llamada del crew de eventos.

## Antes de empezar {#before}

1. **Elige lugar y fecha.** Sirve una pizzería, un bar con cocina, un coworking o un parque. Escoge un sitio con horno cerca o con opción de entrega a domicilio.
2. **Busca co-anfitriones.** Organizar con una o dos personas más reparte el trabajo. Una pizzería local es un gran aliado.
3. **Avisa al crew de eventos.** Cuéntales en qué ciudad estás y cuándo. Pueden ponerte en contacto con otros anfitriones y resolver dudas.
4. **Crea una página para los invitados.** Haz una página del evento en rsv.pizza para que la gente confirme asistencia y para que tu fiesta cuente en las misiones que la piden.
5. **Publícala.** Agrega tu fiesta a la lista de eventos de la comunidad para que la gente cercana la encuentre.

::if eventsUrl
Puedes publicar tu fiesta en el [sitio de eventos]({{eventsUrl}}).
::end

::if hostPlaybookUrl
También hay una [guía del anfitrión]({{hostPlaybookUrl}}) más larga con consejos extra.
::end

## Presupuesto {#budget}

Prepara un presupuesto sencillo antes de gastar: pizza, bebidas, el costo del lugar si lo hay y la impresión de materiales. Copia la plantilla de presupuesto, complétala y compártela con el crew de eventos para su aprobación. Un gasto que no se aprobó antes puede no reembolsarse.

::if hostCapUsd
La DAO puede aportar hasta {{hostCapUsd}} a una fiesta organizada.
::end

::if budgetTemplateUrl
[Abre la plantilla de presupuesto]({{budgetTemplateUrl}}) y haz tu propia copia.
::end

Las pizzerías suelen patrocinar parte de la fiesta. Si una lo hace, indícalo en tu presupuesto para que el aporte de la DAO pueda ser menor.

## Cuentas de pizza {#pizza-math}

No pidas todo de una vez. Pide por tandas, más o menos cada 45 minutos, para que la pizza llegue caliente. Calcula aproximadamente una pizza por cada una y media personas e incluye opciones vegetarianas y veganas. Es mejor pedir de nuevo que quedarse corto o tirar pizza.

## Crea un POAP {#poaps}

Un POAP es una insignia coleccionable que los invitados pueden reclamar para demostrar que estuvieron. Crear uno para tu fiesta es un lindo detalle y además es una de las misiones. Los pasos están en [crear un POAP](/handbook/make-a-poap).

## Anuncia tu fiesta {#announce}

Avisa con tiempo y más de una vez. Publica la página del evento en tus redes, compártela en el Discord de la comunidad y pide ayuda al crew de comunicación con una publicación o un diseño. Etiqueta las cuentas oficiales para que la comunidad también la comparta.

::if hashtags
Usa estos hashtags: {{hashtags}}
::end

## El día del evento {#day-of}

- Llega temprano, revisa el horno o el pedido a domicilio y arma una mesa de bienvenida.
- Recibe a la gente en la puerta. Algunos invitados no conocerán a nadie.
- Únete a la llamada de la comunidad si ese día hay una global, y muestra tu fiesta en pantalla.
- Toma fotos y un video corto. Pide permiso a los invitados antes de publicar sus caras.
- Guarda todos los recibos, incluso los de compras pequeñas.

## Después de la fiesta {#after}

1. **Reúne tus recibos** y anota lo gastado frente a tu presupuesto aprobado.
2. **Solicita el reembolso.** Los requisitos de pago pueden variar según el país, así que pregunta al crew de eventos si no sabes qué se necesita.
3. **Comparte un resumen.** Publica tus fotos y unas líneas sobre cómo salió en Discord y en redes sociales.
4. **Da las gracias** a tu lugar, a tus co-anfitriones y a tus invitados.

::if paymentFormUrl
Envía tu solicitud de reembolso con el [formulario de pago]({{paymentFormUrl}}).
::end

::if gppDate
## Global Pizza Party {#gpp}

La próxima Global Pizza Party es el {{gppDate}}. Fiestas de todo el mundo celebran juntas el mismo día.

Esta es la edición {{gppEdition}}.
::end

::if hostDeadlines
## Fechas límite {#deadlines}

{{hostDeadlines}}
::end
`
