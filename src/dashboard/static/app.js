const EMPTY_UPLOAD_MESSAGE = "Choose a file or enter both an object key and object body.";
const MISSING_TEXT_KEY_MESSAGE = "Enter an object key for the text upload.";
const MISSING_TEXT_BODY_MESSAGE = "Enter an object body for the text upload.";
const UNSAFE_KEY_MESSAGE = "Object key is not safe to store on disk.";
const INTERNAL_BUCKET_METADATA_FILE = ".bentos3-bucket.json";
const UPLOAD_FORM_SELECTOR = "[data-upload-form]";
const UPLOAD_KEY_SELECTOR = "[data-upload-key]";
const UPLOAD_FILE_SELECTOR = "[data-upload-file]";
const UPLOAD_BODY_SELECTOR = "[data-upload-body]";
const UPLOAD_ERROR_SELECTOR = "[data-upload-error]";
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;

document.addEventListener("submit", handleDocumentSubmit);
document.addEventListener("input", handleUploadFieldChange);
document.addEventListener("change", handleUploadFieldChange);

function handleDocumentSubmit(event) {
  const form = event.target;

  if (!(form instanceof HTMLFormElement) || !form.matches(UPLOAD_FORM_SELECTOR)) {
    return;
  }

  const error = validateUploadForm(form);

  if (!error) {
    setUploadError(form, "");
    return;
  }

  event.preventDefault();
  setUploadError(form, error);
  focusUploadKey(form);
}

function handleUploadFieldChange(event) {
  const field = event.target;

  if (!(field instanceof HTMLElement)) {
    return;
  }

  const form = field.closest(UPLOAD_FORM_SELECTOR);

  if (form instanceof HTMLFormElement) {
    setUploadError(form, "");
  }
}

function validateUploadForm(form) {
  const key = readFieldValue(form, UPLOAD_KEY_SELECTOR);
  const body = readFieldValue(form, UPLOAD_BODY_SELECTOR);
  const fileName = readSelectedFileName(form);
  const hasKey = key.length > 0;
  const hasBody = body.length > 0;
  const hasFile = fileName.length > 0;

  if (!hasFile) {
    if (!hasKey && !hasBody) {
      return EMPTY_UPLOAD_MESSAGE;
    }

    if (!hasKey) {
      return MISSING_TEXT_KEY_MESSAGE;
    }

    if (!hasBody) {
      return MISSING_TEXT_BODY_MESSAGE;
    }
  }

  const effectiveKey = hasKey ? key : fileName;

  if (isUnsafeObjectKey(effectiveKey)) {
    return UNSAFE_KEY_MESSAGE;
  }

  return "";
}

function readFieldValue(form, selector) {
  const field = form.querySelector(selector);

  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    return field.value;
  }

  return "";
}

function readSelectedFileName(form) {
  const field = form.querySelector(UPLOAD_FILE_SELECTOR);

  if (!(field instanceof HTMLInputElement)) {
    return "";
  }

  return field.files?.[0]?.name ?? "";
}

function isUnsafeObjectKey(key) {
  const segments = key.split(/[\\/]+/);

  return (
    key.length === 0 ||
    key.startsWith("/") ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(key) ||
    segments.includes("..") ||
    key === INTERNAL_BUCKET_METADATA_FILE
  );
}

function setUploadError(form, message) {
  const error = form.querySelector(UPLOAD_ERROR_SELECTOR);

  if (!(error instanceof HTMLElement)) {
    return;
  }

  error.textContent = message;
  error.hidden = message.length === 0;
}

function focusUploadKey(form) {
  const keyField = form.querySelector(UPLOAD_KEY_SELECTOR);

  if (keyField instanceof HTMLElement) {
    keyField.focus();
  }
}
