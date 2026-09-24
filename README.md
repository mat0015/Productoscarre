# Monitor Carrefour + Telegram en GitHub

Sí: GitHub Actions puede ejecutar la consulta una vez por día sin que tu PC quede encendida. GitHub Actions usa UTC; el cron `7 13 * * *` equivale aproximadamente a las 10:07 de Argentina. Se usa el minuto 7 porque los horarios exactos suelen tener más congestión. GitHub puede demorar algunos minutos una ejecución programada.

## 1. Crear el repositorio

1. Crear un repositorio en GitHub, preferentemente privado.
2. Subir el contenido de esta carpeta conservando `.github/workflows/`.
3. En el repositorio, ir a **Settings > Actions > General** y habilitar Actions.
4. En **Settings > Secrets and variables > Actions**, crear:
   - `TELEGRAM_BOT_TOKEN`: token de `@BotFather`.
   - `TELEGRAM_CHAT_ID`: chat ID al que se enviará el mensaje.
5. En **Actions**, abrir `Consulta diaria Carrefour` y ejecutar **Run workflow** para probarlo.

El workflow instala Node.js, lee `config.json`, consulta los productos, envía siempre la lista completa por Telegram y guarda `history.json` en el repositorio.

## 2. Panel para agregar o quitar productos

El panel permite editar nombre y URL, agregar productos, quitar productos y guardar la configuración en GitHub. No hace falta tocar el código del monitor.

1. Ir a **Settings > Pages** y elegir **GitHub Actions** como fuente.
2. Ejecutar una vez `Publicar panel` desde **Actions**.
3. Abrir la URL que GitHub muestra en **Settings > Pages**.
4. Completar `usuario/repositorio` y dejar la ruta `carrefour-telegram-monitor/config.json`.
5. Crear un fine-grained Personal Access Token con vencimiento corto y únicamente permiso **Contents: Read and write** sobre este repositorio.
6. Pegarlo en el panel, cargar la configuración, editar productos y guardar.

El token queda solo en la memoria de la pestaña y se usa directamente contra la API de GitHub; no se guarda en el repositorio ni en un servidor. Por seguridad, conviene revocarlo después de guardar o usar uno con vencimiento corto. GitHub Pages es público: el panel no muestra los precios ni el token, pero tampoco debe considerarse un sistema de autenticación empresarial.

## 3. Flujo diario

El panel cambia `config.json`; el siguiente workflow diario usa automáticamente la nueva lista. También se puede ejecutar manualmente para probar cambios sin esperar al día siguiente.

## Limitación Carrefour

Carrefour puede aplicar precios por código postal mediante una sesión/cookie o una API interna. Se envía `1686` como señal regional, pero la prueba real debe confirmar que el precio devuelto corresponde a esa ubicación. Si aparece `No disponible`, habrá que implementar el flujo específico de regionalización.
