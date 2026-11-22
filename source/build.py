import os
d=os.path.dirname(os.path.abspath(__file__))+'/'
head=open(d+'head.html').read(); core=open(d+'core.js').read(); sample=open(d+'sample.js').read(); det=open(d+'detect.js').read(); app=open(d+'app.js').read()
det=det.replace("    if (opt.debug) console.log(JSON.stringify(q), 'fill', fill.toFixed(3), 'cov', best.cov.toFixed(2), best.hinge, best.swing, 'ext', exterior);\n","")
out=head+"""
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* Sample plan image + its hand-measured layout (units = pixels of the 850x957 image, 80 px ≈ 1 m) */
"""+sample+"\n"+core+"\n"+det+"\n"+app+"\n</script>\n</body>\n</html>\n"
open(os.path.join(d,'..','index.html'),'w').write(out)
print(len(out))
