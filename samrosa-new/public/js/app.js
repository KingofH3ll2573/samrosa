const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let donors = [];
let recipients = [];
let currentModal = null;
let toastTimer;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value || 0));
}
function dateLabel(value) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function statusBadge(status) {
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  return `<span class="badge badge-${status.toLowerCase()}">${escapeHtml(label)}</span>`;
}
function donationTable(rows) {
  if (!rows.length) return `<div class="empty-state">No donations yet. Log your first surplus food donation to get started.</div>`;
  return `<table class="data-table"><thead><tr><th>Food & donor</th><th>Weight</th><th>Value</th><th>Status</th><th>Date</th></tr></thead><tbody>
    ${rows.map(row => `<tr>
      <td><span class="table-primary">${escapeHtml(row.food_description)}</span><span class="table-secondary">${escapeHtml(row.donor_name || "Donor")}</span></td>
      <td>${Number(row.weight_lbs).toLocaleString()} lbs</td><td>${money(row.estimated_value)}</td>
      <td>${statusBadge(row.status)}</td><td>${dateLabel(row.created_at)}</td>
    </tr>`).join("")}
  </tbody></table>`;
}
async function loadDashboard() {
  const [stats, donations] = await Promise.all([api("/api/dashboard"), api("/api/donations")]);
  $("#stat-donations").textContent = stats.donations.toLocaleString();
  $("#stat-pounds").textContent = Number(stats.pounds).toLocaleString();
  $("#stat-donors").textContent = stats.donors.toLocaleString();
  $("#stat-recipients").textContent = stats.recipients.toLocaleString();
  $("#nav-donation-count").textContent = stats.donations;
  $("#recent-donations").innerHTML = donationTable(donations.slice(0, 5));
  $("#all-donations").innerHTML = donationTable(donations);
}
async function loadDonors() {
  donors = await api("/api/donors");
  $("#donor-list").innerHTML = donors.length ? donors.map(donor => `
    <article class="directory-card"><div class="directory-avatar">${escapeHtml(initials(donor.legal_name))}</div><div>
      <strong>${escapeHtml(donor.legal_name)}</strong>
      <small>${escapeHtml(donor.contact_email)}${donor.city ? `<br>${escapeHtml(donor.city)}` : ""}</small>
      ${donor.contact_phone ? `<small>${escapeHtml(donor.contact_phone)}</small>` : ""}
    </div></article>`).join("") : `<div class="empty-state">No donors yet. Add your first food provider.</div>`;
}
async function loadRecipients() {
  recipients = await api("/api/recipients");
  $("#recipient-list").innerHTML = recipients.length ? recipients.map(recipient => `
    <article class="directory-card"><div class="directory-avatar">${escapeHtml(initials(recipient.legal_name))}</div><div>
      <strong>${escapeHtml(recipient.legal_name)}</strong>
      <small>${escapeHtml(recipient.contact_email || "No email added")}${recipient.city ? `<br>${escapeHtml(recipient.city)}` : ""}</small>
      <span class="verified">${recipient.is_verified ? "✓ Marked as verified" : "○ Verification not confirmed"}</span>
    </div></article>`).join("") : `<div class="empty-state">No recipients yet. Add a community organization.</div>`;
}
function initials(name) {
  return String(name || "?").split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase();
}
async function refreshAll() {
  try {
    await Promise.all([loadDashboard(), loadDonors(), loadRecipients()]);
  } catch (error) {
    showToast(`${error.message} Check that the server and database are running.`, true);
    $("#recent-donations").innerHTML = `<div class="empty-state">Could not connect to the server. Check the backend setup and DATABASE_URL.</div>`;
  }
}
function showView(name) {
  $$(".view").forEach(view => view.classList.toggle("active", view.id === `view-${name}`));
  $$(".nav-link").forEach(link => link.classList.toggle("active", link.dataset.view === name));
  const labels = { overview: "Overview", donations: "Donations", donors: "Donors", recipients: "Recipient partners" };
  $("#breadcrumb-current").textContent = labels[name] || "Overview";
  if (name === "donations") loadDashboard().catch(error => showToast(error.message, true));
  if (name === "donors") loadDonors().catch(error => showToast(error.message, true));
  if (name === "recipients") loadRecipients().catch(error => showToast(error.message, true));
}
function field(name, label, type = "text", options = {}) {
  const full = options.full ? " full" : "";
  const required = options.required ? "required" : "";
  const hint = options.hint ? `<span class="hint">${options.hint}</span>` : "";
  if (type === "select") {
    return `<div class="field${full}"><label for="${name}">${label}</label><select id="${name}" name="${name}" ${required}>${options.options.map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}</select>${hint}</div>`;
  }
  if (type === "textarea") {
    return `<div class="field${full}"><label for="${name}">${label}</label><textarea id="${name}" name="${name}" ${required} ${options.max ? `maxlength="${options.max}"` : ""} placeholder="${escapeHtml(options.placeholder || "")}"></textarea>${hint}</div>`;
  }
  return `<div class="field${full}"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" ${required} ${options.min !== undefined ? `min="${options.min}"` : ""} ${options.step ? `step="${options.step}"` : ""} ${options.max ? `maxlength="${options.max}"` : ""} placeholder="${escapeHtml(options.placeholder || "")}">${hint}</div>`;
}
async function openModal(kind) {
  currentModal = kind;
  $("#form-message").textContent = "";
  $("#record-form").reset();
  const config = {
    donor: {
      eyebrow: "NEW PARTNER", title: "Add a donor", submit: "Save donor",
      fields: `<div class="form-grid">
        ${field("legal_name", "Business / legal name", "text", {required:true,full:true,placeholder:"e.g. Green Market Kitchen"})}
        ${field("contact_email", "Contact email", "email", {required:true,placeholder:"hello@example.com"})}
        ${field("contact_phone", "Phone (optional)", "tel", {placeholder:"(555) 010-1234"})}
        ${field("city", "City (optional)", "text", {placeholder:"New York"})}
      </div>`
    },
    recipient: {
      eyebrow: "COMMUNITY PARTNER", title: "Add a recipient", submit: "Save recipient",
      fields: `<div class="form-grid">
        ${field("legal_name", "Organization name", "text", {required:true,full:true,placeholder:"e.g. Community Food Center"})}
        ${field("contact_email", "Contact email (optional)", "email", {placeholder:"team@example.org"})}
        ${field("city", "City (optional)", "text", {placeholder:"New York"})}
        ${field("is_verified", "Verification status", "select", {options:[{value:"false",label:"Not confirmed"},{value:"true",label:"Marked verified"}],full:true,hint:"Only mark verified if your organization has independently confirmed the status."})}
      </div>`
    },
    donation: {
      eyebrow: "SURPLUS INTAKE", title: "Log a donation", submit: "Save donation",
      fields: `<div class="form-grid">
        ${field("donor_id", "Donor", "select", {required:true,options:[{value:"",label:"Choose a registered donor"}, ...donors.map(d => ({value:d.id,label:d.legal_name}))],full:true})}
        ${field("food_description", "Food description", "text", {required:true,full:true,placeholder:"e.g. Fresh produce boxes"})}
        ${field("category", "Food category", "select", {required:true,options:[{value:"PERISHABLE",label:"Perishable"},{value:"SHELF_STABLE",label:"Shelf-stable"}]})}
        ${field("weight_lbs", "Weight (lbs)", "number", {required:true,min:"0.01",step:"0.01",placeholder:"25"})}
        ${field("item_count", "Item count (optional)", "number", {min:"1",step:"1",placeholder:"e.g. 12"})}
        ${field("estimated_value", "Estimated value ($)", "number", {required:true,min:"0",step:"0.01",placeholder:"0.00"})}
        ${field("recipient_id", "Recipient (optional)", "select", {options:[{value:"",label:"Not assigned yet"}, ...recipients.map(r => ({value:r.id,label:r.legal_name}))],full:true})}
        ${field("pickup_notes", "Pickup / handling notes (optional)", "textarea", {full:true,placeholder:"Pickup window, storage, handling details…"})}
      </div><p class="hint">This starter app records donations; it does not verify food safety, nonprofit eligibility, or tax deductibility.</p>`
    }
  };
  const item = config[kind];
  if (!item) return;
  $("#modal-eyebrow").textContent = item.eyebrow;
  $("#modal-title").textContent = item.title;
  $("#submit-record").innerHTML = `${item.submit} <span>→</span>`;
  $("#form-fields").innerHTML = item.fields;
  $("#modal-backdrop").hidden = false;
  document.body.style.overflow = "hidden";
  const first = $("#form-fields input, #form-fields select, #form-fields textarea");
  if (first) first.focus();
}
function closeModal() {
  $("#modal-backdrop").hidden = true;
  document.body.style.overflow = "";
  currentModal = null;
}
async function submitRecord(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const data = Object.fromEntries(form.entries());
  $("#form-message").textContent = "";
  const submit = $("#submit-record");
  submit.disabled = true;
  submit.textContent = "Saving…";
  try {
    let path;
    if (currentModal === "donor") {
      path = "/api/donors";
    } else if (currentModal === "recipient") {
      data.is_verified = data.is_verified === "true";
      path = "/api/recipients";
    } else if (currentModal === "donation") {
      data.donor_id = Number(data.donor_id);
      data.recipient_id = data.recipient_id ? Number(data.recipient_id) : null;
      data.weight_lbs = Number(data.weight_lbs);
      data.item_count = data.item_count ? Number(data.item_count) : null;
      data.estimated_value = Number(data.estimated_value);
      path = "/api/donations";
    }
    await api(path, { method: "POST", body: JSON.stringify(data) });
    closeModal();
    showToast("Record saved successfully.");
    await refreshAll();
  } catch (error) {
    $("#form-message").textContent = error.message;
  } finally {
    submit.disabled = false;
    const labels = { donor: "Save donor →", recipient: "Save recipient →", donation: "Save donation →" };
    submit.textContent = labels[currentModal] || "Save record →";
  }
}

$$(".nav-link").forEach(link => link.addEventListener("click", () => showView(link.dataset.view)));
$$("[data-go]").forEach(button => button.addEventListener("click", () => showView(button.dataset.go)));
$$("[data-modal]").forEach(button => button.addEventListener("click", () => openModal(button.dataset.modal)));
$("#new-donation-top").addEventListener("click", () => openModal("donation"));
$("#close-modal").addEventListener("click", closeModal);
$("#cancel-modal").addEventListener("click", closeModal);
$("#modal-backdrop").addEventListener("click", event => { if (event.target === $("#modal-backdrop")) closeModal(); });
$("#record-form").addEventListener("submit", submitRecord);
$("#refresh-donations").addEventListener("click", () => loadDashboard().then(() => showToast("Donations refreshed.")).catch(error => showToast(error.message, true)));
document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("#modal-backdrop").hidden) closeModal(); });

refreshAll();
