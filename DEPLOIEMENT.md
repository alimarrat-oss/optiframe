# Mettre OptiFrame en ligne (GitHub Pages, ~5 minutes)

L'app est un site statique : aucun serveur, aucune étape de build. GitHub Pages fournit l'URL HTTPS
(obligatoire pour la caméra) et le dépôt public demandé dans les livrables.

## Option A — depuis le navigateur (sans ligne de commande)

1. Connectez-vous sur <https://github.com> (compte gratuit).
2. **New repository** → nom : `optiframe` → **Public** → ne cochez rien d'autre → **Create repository**.
3. Sur la page du dépôt vide, cliquez sur **uploading an existing file**.
4. Décompressez `optiframe.zip` sur l'ordinateur, ouvrez le dossier `optiframe`, sélectionnez **tout son contenu**
   (fichiers et dossiers : `index.html`, `js`, `lib`, `models`, `assets`, …) et glissez-le dans la page.
   *(Glisser le contenu, pas le dossier lui-même, pour que `index.html` soit à la racine du dépôt.)*
5. En bas : **Commit changes**.
6. **Settings → Pages** → *Build and deployment* : Source = **Deploy from a branch**, Branch = **main**, dossier **/ (root)** → **Save**.
7. Après 1 à 2 minutes, l'URL apparaît en haut de la page *Pages* : `https://<votre-utilisateur>.github.io/optiframe/`.
8. Ouvrez-la sur un téléphone, onglet *Verres* → *Essayer la démo*. Le bouton ▦ (en haut à droite) affiche le **QR code** de l'URL pour la démo.

## Option B — en ligne de commande

```bash
cd optiframe
git init && git add . && git commit -m "OptiFrame"
git branch -M main
git remote add origin https://github.com/<votre-utilisateur>/optiframe.git
git push -u origin main
```
Puis l'étape 6 ci-dessus.

## Après la mise en ligne

- Remplacez `<utilisateur>` dans `README.md` (2 endroits) et le lien *Code source* (`index.html`, `id="srcLink"`) par votre URL.
- Feuille de capture avec le QR code de l'app :
  `python3 assets/make_sheet.py --url https://<votre-utilisateur>.github.io/optiframe/ --out assets/feuille-capture-optiframe.pdf`
- QR code seul (pour la diapo de démo) : bouton ▦ de l'app, ou n'importe quel générateur de QR code.
- Mise à jour : téléversez les fichiers modifiés (ou `git push`). GitHub Pages redéploie en ~1 minute.
  L'app est en « réseau d'abord » : les téléphones en ligne reçoivent la nouvelle version au rechargement.

## Vérifications avant la démo

- [ ] L'URL s'ouvre sur un téléphone « neuf » (Android Chrome **et** iPhone Safari).
- [ ] La caméra s'ouvre (autoriser l'accès), les 4 repères passent au vert.
- [ ] La feuille est imprimée **à 100 %** : 100 mm entre les centres des repères 1 et 2 (règle).
- [ ] Feuille scotchée à plat sur un carton (le dispositif se remonte en moins de 2 minutes).
- [ ] *Monture* → *Télécharger monture.stl* fonctionne ; *Contours SVG 1:1* s'imprime à l'échelle (barre de 50 mm).
