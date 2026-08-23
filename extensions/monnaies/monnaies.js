/* Extension « Monnaies ».
 *
 * CE QUI EST OPTIONNEL, C'EST DE POUVOIR EN AJOUTER. Le noyau sait depuis
 * toujours qu'un montant appartient à une monnaie : la colonne existe partout,
 * les soldes sont calculés monnaie par monnaie, et rien n'additionne jamais
 * deux devises. Ce que cette extension apporte, c'est l'écran qui CRÉE,
 * renomme et supprime des monnaies — et les routes qui vont avec.
 *
 * Sans elle, la base ne contient que la monnaie posée à l'installation, et
 * toute l'interface s'y replie d'elle-même : les barres d'onglets par monnaie
 * disparaissent (elles se masquent déjà à une seule monnaie), le menu de
 * monnaie d'une opération ne s'affiche pas, et le compte n'a qu'un solde
 * initial à saisir. L'application devient mono-devise sans qu'une seule ligne
 * de son code ne s'en aperçoive.
 *
 * L'ÉTEINDRE NE REPLIE RIEN DE FORCE. Une base qui porte déjà plusieurs
 * monnaies continue de les afficher toutes : ses onglets, ses soldes et ses
 * budgets restent lisibles. On perd le droit d'en ajouter, jamais le droit de
 * voir ce qu'on a. C'est la règle du dépôt — désactiver ne fait pas
 * disparaître de données (cf. extensions/README.md).
 *
 * `refreshMonnaies` et `monnaieParId` restent dans le noyau : tout l'écran a
 * besoin de connaître les symboles pour afficher un montant, extension ou pas.
 */


async function loadMonnaies() {
  try {
    await refreshMonnaies();
    renderMonnaies();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

function renderMonnaies() {
  const bloc = document.getElementById("monnaies-liste");
  bloc.innerHTML = "";
  if (state.monnaies.length === 0) {
    bloc.innerHTML = `<span class="hint">${t("Aucune monnaie.")}</span>`;
    return;
  }
  state.monnaies.forEach((monnaie) => {
    const row = document.createElement("div");
    row.className = "import-mapping-row";
    row.dataset.id = monnaie.id;
    row.innerHTML = `
      <span class="import-mapping-nom">${escapeHtml(monnaie.nom)} — ${escapeHtml(monnaie.symbole)}</span>
      <button type="button" data-action="modifier-monnaie" data-id="${monnaie.id}">${t("Modifier")}</button>
      <button type="button" data-action="supprimer-monnaie" data-id="${monnaie.id}" class="danger">${t("Supprimer")}</button>
    `;
    bloc.appendChild(row);
  });

  const editerMonnaie = (id) => {
    const monnaie = monnaieParId(id);
    if (!monnaie) return;
    document.getElementById("monnaie-id").value = monnaie.id;
    document.getElementById("monnaie-nom").value = monnaie.nom;
    document.getElementById("monnaie-symbole").value = monnaie.symbole;
    document.getElementById("monnaie-annuler").style.display = "inline-block";
  };
  activerEditionDoubleClic(bloc, editerMonnaie);

  bloc.querySelectorAll("button[data-action='modifier-monnaie']").forEach((btn) => {
    btn.addEventListener("click", () => editerMonnaie(Number(btn.dataset.id)));
  });

  bloc.querySelectorAll("button[data-action='supprimer-monnaie']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("Supprimer cette monnaie ?"))) return;
      try {
        await apiFetch(`/monnaies/${btn.dataset.id}`, { method: "DELETE" });
        showMessage(t("Monnaie supprimée"), "success");
        await loadMonnaies();
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
  });
}

function resetMonnaieForm() {
  document.getElementById("monnaie-id").value = "";
  document.getElementById("monnaie-nom").value = "";
  document.getElementById("monnaie-symbole").value = "";
  document.getElementById("monnaie-annuler").style.display = "none";
}

document.getElementById("form-monnaie").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("monnaie-id").value;
  const payload = {
    nom: document.getElementById("monnaie-nom").value,
    symbole: document.getElementById("monnaie-symbole").value,
  };
  try {
    if (id) {
      await apiFetch(`/monnaies/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      showMessage(t("Monnaie modifiée"), "success");
    } else {
      await apiFetch("/monnaies", { method: "POST", body: JSON.stringify(payload) });
      showMessage(t("Monnaie créée"), "success");
    }
    resetMonnaieForm();
    await loadMonnaies();
  } catch (err) {
    showMessage(err.message, "error");
  }
});

document.getElementById("monnaie-annuler").addEventListener("click", resetMonnaieForm);
// Le noyau rappelle ce chargeur à chaque ouverture de la sous-page.
BudgetApp.extensions.enregistrer("monnaies", { chargeur: loadMonnaies });
