# Siguiente Capítulo

Seguimiento personal de series y anime (AnimeFLV y Cuevana): capítulos vistos, aviso de capítulos nuevos y webs alternativas para verlos.

- **Web:** `index.html`, servida con GitHub Pages.
- **Datos e inicio de sesión:** Supabase (tablas `series` y `settings`, cada usuario solo ve sus filas).
- **Búsqueda de capítulos:** función de Supabase en `supabase/functions/buscar/index.ts`. Lee la ficha de cada serie, actualiza el último capítulo disponible y comprueba que la web principal abre el siguiente capítulo; si no, pasa a la primera alternativa que funcione.
- `seed.json`: copia inicial de las series para el botón «Importar mis series».
- `src/app.js`: el script de la página (se incrusta en `index.html`).
