#!/usr/bin/env python3
"""Incrusta src/app.js dentro de index.html (entre <script> y </script>) y comprueba la sintaxis."""
import pathlib, subprocess, sys
raiz = pathlib.Path(__file__).resolve().parent.parent
html = (raiz / "index.html").read_text()
app = (raiz / "src/app.js").read_text()
a = html.index("<script>\n") + len("<script>\n")
b = html.index("</script>", a)
html = html[:a] + app + html[b:]
(raiz / "index.html").write_text(html)
r = subprocess.run(["node", "-e", "new Function(require('fs').readFileSync(0,'utf8'))"], input=app, text=True, capture_output=True)
if r.returncode:
    sys.exit("Error de sintaxis en src/app.js:\n" + r.stderr[-800:])
print("index.html actualizado y JS válido")
