// Shared commit-on-leave for code / text editor boxes (code-edit-1).
//
// Every code box (Code module face, Script code box window) commits its text
// the moment the user stops editing — focus leaves the box, or a pointerdown
// lands outside it — exactly as if they had pressed its compact Apply.
// Ctrl/Cmd+Enter commits too. A commit only runs when the text differs from
// what is stored, so each edit session is one undo step.
//
// code-edit-2: the text is validated as the user types (debounced), on leave
// and on Apply — even when it equals the stored document — so the error state
// always describes the text in the box: valid text clears the red border and
// error line at once. Typing the stored text back clears the error and the
// dirty chip and records nothing. Apply is always pressable and re-checks.
//
// Invalid text never wipes anything: it stays in the box, the box is marked
// .is-invalid / aria-invalid, and the stored value is untouched. No hover text
// anywhere (app policy).

const NODE_GRAPH_CODE_EDIT_VALIDATE_MS = 250;

function setNodeGraphCodeEditInvalid(area, invalid, message = "") {
  if (!area) {
    return;
  }
  area.classList.toggle("is-invalid", Boolean(invalid));
  area.setAttribute("aria-invalid", invalid ? "true" : "false");
  if (invalid) {
    area.dataset.codeEditError = String(message || "");
  } else {
    delete area.dataset.codeEditError;
    delete area.dataset.codeEditBase;
  }
}

/**
 * Bind one code box. options:
 *   commit(reason)  -> { ok, message } | undefined   (required; reason "leave" | "apply")
 *   isDirty()       -> boolean  text differs from the stored value
 *   applyButton     -> compact Apply button (optional)
 *   applyClick      -> bind the button's click here (default true)
 *   validate(text)  -> { ok, message }  pure check of the text in the box (optional)
 *   commitInvalid   -> still commit text that fails validate (Script keeps bad code)
 *   onValidate(result)  error state changed / re-checked (update an error line)
 *   onResult(result, reason)
 * Returns { commit(reason), validate(), refresh() }.
 */
function bindNodeGraphCodeEditCommit(area, options = {}) {
  if (!area || typeof options.commit !== "function") {
    return null;
  }
  if (area._nodeGraphCodeEdit) {
    return area._nodeGraphCodeEdit;
  }
  const applyButton = options.applyButton || null;
  const isDirty = () => {
    if (typeof options.isDirty !== "function") {
      return true;
    }
    try {
      return Boolean(options.isDirty());
    } catch (_error) {
      return false;
    }
  };
  const editable = () => !area.readOnly && !area.disabled;
  const refresh = () => {
    const dirty = editable() && isDirty();
    area.classList.toggle("is-dirty", dirty);
    if (applyButton) {
      applyButton.classList.toggle("is-dirty", dirty);
      applyButton.hidden = !editable();
    }
  };
  const validate = () => {
    if (typeof options.validate !== "function") {
      return null;
    }
    try {
      return options.validate(area.value) || { ok: true };
    } catch (error) {
      return { ok: false, message: String(error?.message || error || "Invalid.") };
    }
  };
  const show = (result) => {
    const ok = !result || result.ok !== false;
    setNodeGraphCodeEditInvalid(area, !ok, ok ? "" : result?.message);
    if (typeof options.onValidate === "function") {
      options.onValidate(result || { ok: true });
    }
  };
  let validateTimer = 0;
  const cancelValidate = () => {
    if (validateTimer) {
      window.clearTimeout(validateTimer);
      validateTimer = 0;
    }
  };
  const recheck = () => {
    cancelValidate();
    const check = validate();
    if (check) {
      show(check);
    }
    refresh();
    return check;
  };
  const run = (reason = "apply") => {
    if (!editable()) {
      return null;
    }
    cancelValidate();
    const check = validate();
    if (check && check.ok === false && !options.commitInvalid) {
      show(check);
      if (typeof options.onResult === "function") {
        options.onResult(check, reason);
      }
      refresh();
      return check;
    }
    // Same as what is stored: nothing to save, no undo step — but the error
    // state still follows the text (the stored document is the valid one).
    if (!isDirty()) {
      const same = { ...(check || { ok: true }), unchanged: true };
      show(same);
      if (typeof options.onResult === "function") {
        options.onResult(same, reason);
      }
      refresh();
      return same;
    }
    let result;
    try {
      result = options.commit(reason);
    } catch (error) {
      result = { ok: false, message: String(error?.message || error || "Commit failed.") };
    }
    show(result && result.ok === false ? result : (check || { ok: true }));
    if (typeof options.onResult === "function") {
      options.onResult(result, reason);
    }
    refresh();
    return result;
  };
  area.addEventListener("focusout", () => run("leave"));
  area.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === "enter") {
      event.preventDefault();
      run("apply");
    }
  });
  area.addEventListener("input", () => {
    refresh();
    if (typeof options.validate === "function") {
      cancelValidate();
      validateTimer = window.setTimeout(() => {
        validateTimer = 0;
        recheck();
      }, NODE_GRAPH_CODE_EDIT_VALIDATE_MS);
    }
  });
  if (applyButton) {
    // Keep the caret in the box: Apply commits without a blur first, and is
    // never a Tab stop (Tab out of the box is a normal leave → commit).
    applyButton.tabIndex = -1;
    applyButton.addEventListener("mousedown", (event) => event.preventDefault());
    if (options.applyClick !== false) {
      applyButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        run("apply");
      });
    }
  }
  const handle = { area, applyButton, commit: run, validate: recheck, refresh };
  area._nodeGraphCodeEdit = handle;
  refresh();
  return handle;
}

// The workspace swallows pointerdown in places (pan, module drags), which can
// leave the caret in a code box. Any pointerdown outside the focused box ends
// the edit: blur it, and its focusout commits.
function nodeGraphCodeEditPointerDownOutside(event) {
  const active = document.activeElement;
  const handle = active?._nodeGraphCodeEdit;
  if (!handle) {
    return;
  }
  const target = event.target;
  if (target === active || active.contains?.(target)) {
    return;
  }
  if (handle.applyButton && (target === handle.applyButton || handle.applyButton.contains?.(target))) {
    return;
  }
  active.blur();
}

if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", nodeGraphCodeEditPointerDownOutside, true);
  // Leaving the page / tab mid-edit still saves what was typed.
  window.addEventListener("pagehide", () => {
    document.activeElement?._nodeGraphCodeEdit?.commit("leave");
  });
}
