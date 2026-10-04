// Textes de l'interface (français / anglais).
export const STR = {
  appTagline: { fr: 'Des verres recyclés à la monture imprimée en 3D', en: 'From recycled lenses to a 3D-printed frame' },
  tabLenses: { fr: 'Verres', en: 'Lenses' },
  tabFrame: { fr: 'Monture', en: 'Frame' },
  tabSteps: { fr: 'Pas à pas', en: 'Step by step' },
  tabHelp: { fr: 'Guide', en: 'Guide' },
  share: { fr: 'Partager', en: 'Share' },
  OD: { fr: 'Verre droit (OD)', en: 'Right lens (OD)' },
  OG: { fr: 'Verre gauche (OG)', en: 'Left lens (OS)' },
  odShort: { fr: 'OD', en: 'OD' },
  ogShort: { fr: 'OG', en: 'OS' },
  camera: { fr: 'Caméra', en: 'Camera' },
  import: { fr: 'Importer', en: 'Import' },
  demo: { fr: 'Essayer la démo', en: 'Try the demo' },
  demoHint: { fr: 'Deux vraies photos : un verre clair (OD) et un verre teinté (OG).', en: 'Two real photos: a clear lens (OD) and a tinted lens (OS).' },
  notMeasured: { fr: 'Pas encore mesuré', en: 'Not measured yet' },
  widthA: { fr: 'Largeur A', en: 'Width A' },
  heightB: { fr: 'Hauteur B', en: 'Height B' },
  perimeter: { fr: 'Périmètre', en: 'Perimeter' },
  ed: { fr: 'Diamètre effectif', en: 'Effective diameter' },
  shots: { fr: 'Prises', en: 'Shots' },
  shot: { fr: 'Prise', en: 'Shot' },
  addShot: { fr: 'Autre prise', en: 'New shot' },
  useShot: { fr: 'Utiliser', en: 'Use' },
  average: { fr: 'Moyenne des prises', en: 'Average of shots' },
  consistency: { fr: 'Écart entre prises', en: 'Shot-to-shot spread' },
  remove: { fr: 'Supprimer', en: 'Remove' },
  mirror: { fr: 'Miroir', en: 'Mirror' },
  rotate180: { fr: 'Pivoter 180°', en: 'Rotate 180°' },
  nasal: { fr: 'nasal', en: 'nasal' },
  svgLens: { fr: 'Contour SVG 1:1', en: 'Outline SVG 1:1' },
  processing: { fr: 'Analyse en cours…', en: 'Analysing…' },
  stepMarkers: { fr: 'Recherche des 4 repères', en: 'Finding the 4 markers' },
  stepRectify: { fr: 'Redressement vue de dessus', en: 'Top-view rectification' },
  stepSegment: { fr: 'Segmentation IA du verre', en: 'AI lens segmentation' },
  stepContour: { fr: 'Contour et mesures', en: 'Outline and measurements' },
  stepFrame: { fr: 'Génération de la monture', en: 'Generating the frame' },
  bridge: { fr: 'Largeur du pont', en: 'Bridge width' },
  rimWidth: { fr: 'Largeur du cercle', en: 'Rim width' },
  edgeThick: { fr: 'Épaisseur du bord du verre', en: 'Lens edge thickness' },
  clearance: { fr: 'Jeu verre / rainure', en: 'Lens / groove clearance' },
  lipBack: { fr: 'Lèvre de clipsage (arrière)', en: 'Snap lip (back)' },
  lipFront: { fr: 'Butée avant', en: 'Front stop' },
  tenons: { fr: 'Tenons des branches', en: 'Temple hinges' },
  advanced: { fr: 'Réglages avancés', en: 'Advanced settings' },
  generate: { fr: 'Générer la monture', en: 'Generate the frame' },
  downloadStl: { fr: 'Télécharger monture.stl', en: 'Download monture.stl' },
  downloadSvg: { fr: 'Contours SVG 1:1', en: 'Outlines SVG 1:1' },
  downloadJson: { fr: 'Mesures (JSON)', en: 'Measurements (JSON)' },
  needTwo: { fr: 'Mesurez un verre droit et un verre gauche pour générer la monture.', en: 'Measure a right and a left lens to generate the frame.' },
  needOne: { fr: 'Il manque un verre : la monture utilise le même contour en miroir.', en: 'One lens is missing: the frame mirrors the measured outline.' },
  frameOk: { fr: 'Maillage fermé (manifold)', en: 'Closed mesh (manifold)' },
  triangles: { fr: 'triangles', en: 'triangles' },
  volume: { fr: 'Volume', en: 'Volume' },
  printTime: { fr: 'Impression : face avant sur le plateau, sans supports', en: 'Print front face down, no supports' },
  thickness: { fr: 'Épaisseur', en: 'Thickness' },
  frameWidth: { fr: 'Largeur totale', en: 'Overall width' },
  fit: { fr: 'Cohérence verre / cercle', en: 'Lens / rim consistency' },
  fitDetail: { fr: 'Écart mesuré dans la rainure (coupe du maillage)', en: 'Gap measured in the groove (mesh slice)' },
  mean: { fr: 'moyen', en: 'mean' },
  max: { fr: 'max', en: 'max' },
  stepsIntro: { fr: 'Images intermédiaires de la dernière photo analysée.', en: 'Intermediate images of the last analysed photo.' },
  s1: { fr: '1. Photo et repères détectés', en: '1. Photo and detected markers' },
  s2: { fr: '2. Image redressée (vue de dessus, 0,25 mm/pixel)', en: '2. Rectified image (top view, 0.25 mm/pixel)' },
  s3: { fr: '3. Probabilité « verre » prédite par le réseau', en: '3. “Lens” probability predicted by the network' },
  s4: { fr: '4. Contour, rectangle boxing et mesures', en: '4. Outline, boxing rectangle and measurements' },
  noSteps: { fr: 'Analysez une photo pour voir les étapes.', en: 'Analyse a photo to see the steps.' },
  timings: { fr: 'Temps de calcul', en: 'Processing time' },
  camTilt: { fr: 'Inclinaison caméra', en: 'Camera tilt' },
  camHeight: { fr: 'Hauteur caméra', en: 'Camera height' },
  parallax: { fr: 'Correction de parallaxe max', en: 'Max parallax correction' },
  sharpness: { fr: 'Flou mesuré', en: 'Measured blur' },
  method: { fr: 'Méthode', en: 'Method' },
  methodAi: { fr: 'IA (U-Net entraîné)', en: 'AI (trained U-Net)' },
  methodClassic: { fr: 'Seuillage classique (repli)', en: 'Classical threshold (fallback)' },
  // erreurs
  'err-no-markers': { fr: 'Je ne trouve pas les repères noirs de la feuille. Cadrez toute la grille avec ses 4 carrés noirs.', en: 'I cannot find the black markers. Frame the whole grid with its 4 black squares.' },
  'err-markers-missing': { fr: 'Les 4 repères ne sont pas tous visibles. Reculez un peu et gardez les 4 carrés noirs dans l\'image.', en: 'Not all 4 markers are visible. Step back and keep the 4 black squares in the picture.' },
  'err-markers-inconsistent': { fr: 'Repères mal reconnus (repère masqué, reflet, ombre forte ou feuille pliée). Dégagez les 4 carrés noirs, aplatissez la feuille et reprenez.', en: 'Markers not recognised (hidden marker, glare, strong shadow or folded sheet). Uncover the 4 black squares, flatten the sheet and retake.' },
  'err-sheet-cut': { fr: 'La grille sort de l\'image. Reculez un peu pour voir toute la grille.', en: 'The grid is cut off. Step back to see the whole grid.' },
  'err-no-lens': { fr: 'Aucun verre détecté. Posez le verre au centre de la grille, face bombée vers le haut.', en: 'No lens found. Put the lens in the middle of the grid, convex side up.' },
  'err-lens-cut': { fr: 'Le verre touche le bord de la zone de mesure. Recentrez-le dans la grille.', en: 'The lens touches the edge of the measuring area. Move it to the centre of the grid.' },
  'err-lens-small': { fr: 'L\'objet détecté est trop petit pour être un verre. Vérifiez qu\'il n\'y a qu\'un verre sur la grille.', en: 'The detected object is too small for a lens. Check that only one lens is on the grid.' },
  'err-lens-big': { fr: 'L\'objet détecté est trop grand pour un verre. Retirez les autres objets de la grille.', en: 'The detected object is too large for a lens. Remove other objects from the grid.' },
  'err-blurry': { fr: 'Photo floue (ou trop sombre). Tenez le téléphone immobile, touchez l\'écran pour faire la mise au point, éclairez la feuille, puis reprenez.', en: 'Blurry (or too dark) photo. Hold the phone still, tap to focus, light the sheet, then retake.' },
  'err-tilted': { fr: 'Téléphone trop incliné. Tenez-le à plat, au-dessus du verre.', en: 'Phone too tilted. Hold it flat, right above the lens.' },
  'err-decode': { fr: 'Impossible de lire cette image. Essayez une photo JPEG ou PNG.', en: 'Cannot read this image. Try a JPEG or PNG photo.' },
  'err-camera': { fr: 'Caméra indisponible ou refusée. Utilisez « Importer » pour choisir une photo.', en: 'Camera unavailable or denied. Use “Import” to pick a photo.' },
  'err-model': { fr: 'Modèle IA non chargé : repli sur le seuillage classique (verres teintés uniquement).', en: 'AI model not loaded: classical fallback (tinted lenses only).' },
  'err-generic': { fr: 'Une erreur inattendue est survenue. Reprenez la photo.', en: 'Something went wrong. Please retake the photo.' },
  // avertissements
  'warn-near-border': { fr: 'Verre proche du bord de la grille.', en: 'Lens close to the grid border.' },
  'warn-soft': { fr: 'Photo un peu floue : vérifiez le contour.', en: 'Photo slightly soft: check the outline.' },
  'warn-tilted': { fr: 'Photo prise de biais : correction de parallaxe appliquée. Pour plus de précision, tenez le téléphone à plat.', en: 'Oblique photo: parallax correction applied. Hold the phone flat for best accuracy.' },
  'warn-rotated': { fr: 'Verre posé de travers par rapport à la grille : A et B sont mesurés selon la grille.', en: 'Lens rotated relative to the grid: A and B follow the grid axes.' },
  'warn-uncertain': { fr: 'Contour incertain par endroits (reflet ?). Déplacez la lumière et reprenez.', en: 'Outline uncertain in places (glare?). Move the light and retake.' },
  'warn-no-ai': { fr: 'Mesure sans IA (modèle non chargé).', en: 'Measured without AI (model not loaded).' },
  // caméra
  camGuide: { fr: 'Cadrez les 4 repères, téléphone à plat au-dessus du verre (20 à 30 cm).', en: 'Frame the 4 markers, phone flat above the lens (20–30 cm).' },
  camOk: { fr: '4 repères détectés : vous pouvez photographier', en: '4 markers found: take the picture' },
  camSearching: { fr: 'Recherche des repères…', en: 'Looking for the markers…' },
  camFlat: { fr: 'Tenez le téléphone plus à plat', en: 'Hold the phone flatter' },
  camMove: { fr: 'Déplacez le téléphone {arrow} au-dessus du verre', en: 'Move the phone {arrow} above the lens' },
  capture: { fr: 'Photographier', en: 'Capture' },
  cancel: { fr: 'Annuler', en: 'Cancel' },
  close: { fr: 'Fermer', en: 'Close' },
  // aide
  helpTitle: { fr: 'Dispositif de capture (2 minutes)', en: 'Capture setup (2 minutes)' },
  help1: { fr: 'Imprimez la feuille de capture à 100 % (sans « ajuster à la page »). Vérifiez à la règle : 100 mm entre les repères 1 et 2.', en: 'Print the capture sheet at 100% (no “fit to page”). Check with a ruler: 100 mm between markers 1 and 2.' },
  help2: { fr: 'Posez la feuille bien à plat sur une surface mate (scotchez les coins ou posez-la sur un carton).', en: 'Lay the sheet flat on a matte surface (tape the corners or use a piece of cardboard).' },
  help3: { fr: 'Posez le verre au centre de la grille, face bombée vers le haut, tel qu\'on le voit de face sur les lunettes (côté nasal vers le centre des lunettes), bord horizontal parallèle à la grille.', en: 'Place the lens in the middle of the grid, convex side up, as seen from the front of the glasses, with its horizontal axis parallel to the grid.' },
  help4: { fr: 'Tenez le téléphone à plat, à 20–30 cm, au-dessus du verre. Gardez les 4 repères dans l\'image. Évitez les reflets sur le bord du verre (déplacez la lampe plutôt que la feuille).', en: 'Hold the phone flat, 20–30 cm above the lens, with the 4 markers in view. Avoid glare on the lens edge (move the lamp, not the sheet).' },
  help5: { fr: 'Choisissez l\'œil (OD/OG) avant la photo. Faites 2 ou 3 prises par verre : l\'app affiche l\'écart entre les prises.', en: 'Pick the eye (OD/OS) before shooting. Take 2–3 shots per lens: the app shows the spread between shots.' },
  sheetPdf: { fr: 'Feuille de capture (PDF)', en: 'Capture sheet (PDF)' },
  settings: { fr: 'Réglages de mesure', en: 'Measurement settings' },
  sheetX: { fr: 'Écart mesuré repères 1→2 (mm)', en: 'Measured spacing markers 1→2 (mm)' },
  sheetY: { fr: 'Écart mesuré repères 1→4 (mm)', en: 'Measured spacing markers 1→4 (mm)' },
  edgeH: { fr: 'Hauteur du bord pour la parallaxe (mm)', en: 'Edge height for parallax (mm)' },
  gridRef: { fr: 'Verres clairs : correction par la continuité de la grille (expérimental)', en: 'Clear lenses: grid-continuity correction (experimental)' },
  about: { fr: 'À propos', en: 'About' },
  aboutText: { fr: 'OptiFrame — défi SN-SF (CodeML). Traitement 100 % dans le navigateur : la photo ne quitte pas le téléphone. Segmentation par un U-Net entraîné sur des images synthétiques réalistes, monture générée avec manifold-3d.', en: 'OptiFrame — SN-SF challenge (CodeML). Everything runs in the browser: photos never leave the phone. Segmentation by a U-Net trained on realistic synthetic images, frame generated with manifold-3d.' },
  source: { fr: 'Code source et documentation', en: 'Source code and documentation' },
  shareTitle: { fr: 'Ouvrir OptiFrame sur un téléphone', en: 'Open OptiFrame on a phone' },
  mm: { fr: 'mm', en: 'mm' },
  retake: { fr: 'Reprendre', en: 'Retake' },
  modelLoading: { fr: 'Chargement du modèle IA…', en: 'Loading the AI model…' },
  modelReady: { fr: 'Modèle IA prêt', en: 'AI model ready' },
  offlineReady: { fr: 'Disponible hors ligne', en: 'Available offline' },
};

let lang = 'fr';
// Français par défaut (langue du défi) ; ?lang=en ou le bouton FR/EN pour l'anglais (mémorisé).
try { lang = new URLSearchParams(location.search).get('lang') || localStorage.getItem('optiframe-lang') || 'fr'; } catch (e) { /* stockage indisponible */ }
if (lang !== 'fr' && lang !== 'en') lang = 'fr';

export function getLang() { return lang; }
export function setLang(l) {
  lang = l;
  try { localStorage.setItem('optiframe-lang', l); } catch (e) { /* ignore */ }
  document.documentElement.lang = l;
  applyI18n();
}
export function t(key, params) {
  const e = STR[key];
  let s = e ? e[lang] || e.fr : key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, v);
  return s;
}
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', t(el.dataset.i18nTitle)); });
}
export function fmt(v, d = 1) {
  if (v == null || !isFinite(v)) return '–';
  return lang === 'fr' ? v.toFixed(d).replace('.', ',') : v.toFixed(d);
}
