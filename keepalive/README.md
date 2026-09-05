# Keepalive

Una función programada de Netlify que despierta los dos servicios de Render y
dispara las tareas programadas de NovaChat.

## Por qué no es un cron de GitHub

Lo era, y **nunca llegó a ejecutarse**. Dos workflows programados (`keepalive` y
`tareas`) estuvieron seis horas en `main` con crons de diez y quince minutos: la
única ejecución de cada uno fue la del push que los creó. No era falta de
minutos — la facturación de Actions iba en 1,17 $ consumidos y 1,17 $ de
descuento. El planificador de GitHub simplemente no los lanzaba.

Las funciones programadas de Netlify entran en el plan gratuito, admiten cron
de hasta un minuto y se ejecutan de verdad.

## Por qué solo doce horas al día

Render regala **750 horas de instancia al mes por cuenta**, compartidas entre
todos los servicios gratuitos, y **suspende todos** al agotarlas hasta el mes
siguiente. Aquí hay dos servicios gratuitos:

| Ventana                | Horas/mes (2 servicios) | ¿Cabe en 750? |
| ---------------------- | ----------------------- | ------------- |
| 24 h                   | 1.460                   | No — se suspende a mitad de mes |
| 16 h                   | 960                     | No            |
| **12 h (esta)**        | **720**                 | Sí, con 30 h de margen |
| 11 h                   | 660                     | Sí, con 90 h de margen |

El cron está en UTC: `*/10 8-19 * * *` son las 10:00–21:59 en España en verano
y las 09:00–20:59 en invierno. Cada hora diaria que se añada cuesta 60 horas de
Render al mes. Fuera de la ventana los servicios se duermen como hasta ahora y
la primera visita paga el arranque de casi un minuto.

Ojo: el consumo real incluye el uso normal, no solo los pings. En lo que va de
mes iban 9,28 horas de 750 con los servicios durmiendo casi siempre.

## Montarlo

1. En [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import
   an existing project** → GitHub → repositorio `novachat`.
2. **Base directory**: `keepalive`. Build command vacío, publish `public`.
   (Lo dice ya el `netlify.toml`, pero Netlify pregunta.)
3. Deploy. La función aparece en **Functions → despertar** con su etiqueta de
   programada y su próxima ejecución.
4. Opcional, para que funcione "Programado" de NovaChat: en **Site
   configuration → Environment variables** añadir `TASKS_SECRET` con el mismo
   valor que tenga en Render. Sin ella la función solo despierta, que es lo
   que hace falta el 90 % del tiempo.

Para comprobar que va: **Functions → despertar → Logs**. Cada ejecución imprime
una línea con el estado y el tiempo de cada servicio. `arrancando` significa que
estaba dormido y se le ha dado el empujón — es un acierto, no un fallo.

## Cambiar la ventana

Última línea de `netlify/functions/despertar.mjs`. `8-19` son las horas UTC.
