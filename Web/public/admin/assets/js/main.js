const escHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

const initialTinyMCE = () => {
  tinymce.init({
    selector: '[textarea-mce]',
    license_key: 'gpl',
    promotion: false,
    height: 500,
    plugins: [
      'accordion', 'anchor', 'autolink', 'autoresize',
      'charmap', 'code', 'codesample', 'emoticons',
      'image', 'link', 'lists', 'media'
    ],
    toolbar: 'undo redo | styles | bold italic | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | link image | preview media fullscreen | forecolor backcolor emoticons | charmap code codesample | help',
    file_picker_callback: (callback, value, meta) => {
      window.activeTinyMCECallback = callback;
      const modal = document.querySelector("#modalFileManager");
      if(modal) {
        const bsModal = bootstrap.Modal.getInstance(modal) || new bootstrap.Modal(modal);
        bsModal.show();
      }
    },
    init_instance_callback: (editor) => {
      // TinyMCE leaves the editor iframe without a title; name it after the field's label.
      const label = document.querySelector(`label[for="${editor.id}"]`);
      editor.iframeElement?.setAttribute('title', `${label ? label.textContent.trim() : 'Rich text'} editor`);

      editor.on("OpenWindow", () => {
        const title = document.querySelector(".tox .tox-dialog__title")?.innerHTML;
        if(title == "Insert/Edit Media" || title == "Insert/Edit Image") {
          const inputSource = document.querySelector(`.tox input.tox-textfield[type="url"]`);
          inputSource.value = domainCDN;
        }
      })
    }
  });
}
initialTinyMCE();

var notyf = new Notyf({
  duration: 3000,
  position: {
    x:'right',
    y:'top'
  },
  dismissible: true
});

const notifyData = sessionStorage.getItem("notify");
if(notifyData) {
  const { type, message } = JSON.parse(notifyData);
  if(type == "error") {
    notyf.error(message);
  } else if(type == "success") {
    notyf.success(message);
  }
  sessionStorage.removeItem("notify");
}

const drawNotify = (type, message) => {
  sessionStorage.setItem("notify", JSON.stringify({
    type: type,
    message: message
  }));
}

document.addEventListener('submit', function(e) {
  const form = e.target;
  const btn = form.querySelector('[type="submit"]');
  if (!btn) return;
  requestAnimationFrame(() => {
    if (form.querySelector('.just-validate-error-label')) return;
    btn.classList.add('is-loading');
    btn.setAttribute('disabled', '');
    setTimeout(() => {
      btn.classList.remove('is-loading');
      btn.removeAttribute('disabled');
    }, 15000);
  });
}, true);

document.querySelectorAll('[data-date-filter]').forEach(function(form) {
  function isValidDate(val) {
    var m = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(val);
    if (!m) return false;
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    var maxDay = new Date(y, mo, 0).getDate();
    return d <= maxDay;
  }

  var formId = form.getAttribute('id');
  if (!formId) return;

  var validator = new JustValidate('#' + formId, { validateBeforeSubmitting: true });
  validator
    .addField('#' + formId + ' [name="from"]', [
      { rule: 'required', errorMessage: 'Please select a start date' },
      { rule: 'custom', validator: isValidDate, errorMessage: 'Invalid date - check day, month (1-12), year' },
    ])
    .addField('#' + formId + ' [name="to"]', [
      { rule: 'required', errorMessage: 'Please select an end date' },
      { rule: 'custom', validator: isValidDate, errorMessage: 'Invalid date - check day, month (1-12), year' },
      {
        rule: 'custom',
        validator: function(val) {
          var fromVal = form.querySelector('[name="from"]').value;
          return !fromVal || new Date(val) >= new Date(fromVal);
        },
        errorMessage: 'End date must be on or after start date',
      },
    ])
    .onSuccess(function() {
      var from = form.querySelector('[name="from"]').value;
      var to   = form.querySelector('[name="to"]').value;
      document.dispatchEvent(new CustomEvent('dashboard-filter-apply', { detail: { from: from, to: to } }));
    });
});

const showConfirm = ({ title = "Delete", message = "This action cannot be undone.", okText = "Delete", okClass = "btn-danger", onOk }) => {
  const modal = document.querySelector("#modalConfirm");
  if (!modal || typeof bootstrap === "undefined") {
    notyf.error("Confirmation is unavailable. Please reload the page.");
    return;
  }
  document.getElementById("modalConfirmTitle").textContent = title;
  document.getElementById("modalConfirmMessage").textContent = message;
  const previousOk = document.getElementById("modalConfirmOk");
  const okBtn = previousOk.cloneNode(true);
  previousOk.replaceWith(okBtn);
  okBtn.textContent = okText;
  okBtn.className = `btn px-4 ${okClass}`;
  const bsModal = bootstrap.Modal.getOrCreateInstance(modal);
  const handler = () => {
    bsModal.hide();
    okBtn.removeEventListener("click", handler);
    onOk();
  };
  okBtn.addEventListener("click", handler);
  bsModal.show();
}

const jsonEditor = document.querySelector("[json-editor]");
if(jsonEditor) {
  const editor = new JSONEditor(jsonEditor, {
    mode: "tree",
    modes: ["text", "tree"],
  })

  const data = jsonEditor.getAttribute("data");
  editor.set(data ? JSON.parse(data) : {});

  window.blockJsonEditor = editor;
}

const articleCreateCategoryForm = document.querySelector("#articleCreateCategoryForm");
if(articleCreateCategoryForm) {
  const validator = new JustValidate('#articleCreateCategoryForm');

  validator
    .addField('#name', [
      {
        rule: 'required',
        errorMessage: 'Please enter category name!',
      },
    ])
    .addField('#slug', [
      {
        rule: 'required',
        errorMessage: 'Please enter slug!',
      },
    ])
    .onSuccess((event) => {
      const name = event.target.name.value;
      const slug = event.target.slug.value;
      const parent = event.target.parent.value;
      const status = event.target.status.value;
      const avatar = event.target.avatar.value;
      const description = tinymce.get("description").getContent();

      const formData = new FormData();
      formData.append("name", name);
      formData.append("slug", slug);
      formData.append("parent", parent);
      formData.append("status", status);
      formData.append("avatar", avatar);
      formData.append("description", description);

      fetch(`/${pathAdmin}/api/article-categories`, {
        method: "POST",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            drawNotify(data.code, data.message);
            location.reload();
          }
        })
    });
}

const articleEditCategoryForm = document.querySelector("#articleEditCategoryForm");
if(articleEditCategoryForm) {
  const validator = new JustValidate('#articleEditCategoryForm');

  validator
    .addField('#name', [
      {
        rule: 'required',
        errorMessage: 'Please enter category name!',
      },
    ])
    .addField('#slug', [
      {
        rule: 'required',
        errorMessage: 'Please enter slug!',
      },
    ])
    .onSuccess((event) => {
      const id = event.target.id.value;
      const name = event.target.name.value;
      const slug = event.target.slug.value;
      const parent = event.target.parent.value;
      const status = event.target.status.value;
      const avatar = event.target.avatar.value;
      const description = tinymce.get("description").getContent();

      const formData = new FormData();
      formData.append("name", name);
      formData.append("slug", slug);
      formData.append("parent", parent);
      formData.append("status", status);
      formData.append("avatar", avatar);
      formData.append("description", description);

      fetch(`/${pathAdmin}/api/article-categories/${id}`, {
        method: "PATCH",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            notyf.success(data.message);
          }
        })
    });
}

const buttonGenerateSlug = document.querySelector("[btn-generate-slug]");
if(buttonGenerateSlug) {
  buttonGenerateSlug.addEventListener("click", () => {
    const modalName = buttonGenerateSlug.getAttribute("btn-generate-slug");
    const from = buttonGenerateSlug.getAttribute("from");
    const to = buttonGenerateSlug.getAttribute("to");
    const string = document.querySelector(`[name="${from}"]`).value;

    const dataFinal = {
      string: string,
      modalName: modalName
    };

    fetch(`/${pathAdmin}/api/slugs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(dataFinal)
    })
      .then(res => res.json())
      .then(data => {
        if(data.code == "error") {
          notyf.error(data.message);
        }

        if(data.code == "success") {
          document.querySelector(`[name="${to}"]`).value = data.slug;
        }
      })
  })
}

const listButtonApi = document.querySelectorAll("[button-api]");
if(listButtonApi.length > 0) {
  listButtonApi.forEach(button => {
    button.addEventListener("click", () => {
      const method = button.getAttribute("data-method");
      const api = button.getAttribute("data-api");

      const doFetch = () => {
        button.classList.add("is-loading");
        button.setAttribute("disabled", "");
        fetch(api, {
          method: method || "GET"
        })
          .then(res => res.json())
          .then(data => {
            button.classList.remove("is-loading");
            button.removeAttribute("disabled");
            if(data.code == "error") {
              notyf.error(data.message);
            }

            if(data.code == "success") {
              drawNotify(data.code, data.message);
              location.reload();
            }
          })
          .catch(() => {
            button.classList.remove("is-loading");
            button.removeAttribute("disabled");
          });
      };

      const isDeleteAction = method === "DELETE" || api.includes("/delete/") || api.includes("/destroy/");
      if (isDeleteAction) {
        const isPermanent = button.getAttribute("data-confirm") !== "trash" && (method === "DELETE" || api.includes("/destroy/"));
        showConfirm({
          title: isPermanent ? "Delete Permanently" : "Move to Trash",
          message: isPermanent ? "This action cannot be undone. Are you sure?" : "Move this item to trash?",
          okText: isPermanent ? "Delete" : "Move to Trash",
          okClass: "btn-danger",
          onOk: doFetch
        });
      } else {
        doFetch();
      }
    })
  })
}

const formSearch = document.querySelector("[form-search]");
if(formSearch) {
  const url = new URL(window.location.href);

  formSearch.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = event.target.keyword.value;
    if(value) {
      url.searchParams.set("keyword", value);
    } else {
      url.searchParams.delete("keyword");
    }
    window.location.href = url.href;
  })

  const valueCurrent = url.searchParams.get("keyword");
  if(valueCurrent) {
    formSearch.keyword.value = valueCurrent;
  }
}

document.querySelectorAll("[paginate]").forEach(el => {
  el.addEventListener("click", () => {
    const page = parseInt(el.getAttribute("data-page"));
    if (!page || page < 1) return;
    const url = new URL(window.location.href);
    url.searchParams.set("page", page);
    window.location.href = url.href;
  });
});

const listButtonSelectFile = document.querySelectorAll("[button-select-file]");
if(listButtonSelectFile.length > 0) {
  listButtonSelectFile.forEach(button => {
    button.addEventListener("click", () => {
      const content = button.getAttribute("data-content");
      window.parent.postMessage({ fileLink: content }, window.location.origin);
    })
  })
}

const listButtonCopy = document.querySelectorAll("[button-copy]");
if(listButtonCopy.length > 0) {
  listButtonCopy.forEach(button => {
    button.addEventListener("click", () => {
      const content = button.getAttribute("data-content");
      window.navigator.clipboard.writeText(content);
      notyf.success("Copied!");
    })
  })
}

const modalPreviewFile = document.querySelector("#modalPreviewFile");
if(modalPreviewFile) {
  const innerPreview = modalPreviewFile.querySelector(".inner-preview");

  let buttonClicked = null;

  const listButtonPreviewFile = document.querySelectorAll("[button-preview-file]");
  listButtonPreviewFile.forEach(button => {
    button.addEventListener("click", () => {
      buttonClicked = button;
    })
  })

  modalPreviewFile.addEventListener('hidden.bs.modal', event => {
    buttonClicked = null;
    innerPreview.innerHTML = "";
  })

  modalPreviewFile.addEventListener('shown.bs.modal', event => {
    const file = buttonClicked.getAttribute("data-file");
    const mimetype = buttonClicked.getAttribute("data-mimetype");

    if(mimetype.includes("image")) {
      innerPreview.innerHTML = `
        <img src="${escHtml(file)}" width="100%" />
      `;
    }
    else if(mimetype.includes("audio")) {
      innerPreview.innerHTML = `
        <audio controls>
          <source src="${escHtml(file)}" />
        </audio>
      `;
    }
    else if(mimetype.includes("video")) {
      innerPreview.innerHTML = `
        <video controls width="100%">
          <source src="${escHtml(file)}" />
        </video>
      `;
    }
    else if(mimetype.includes("application/pdf")) {
      innerPreview.innerHTML = `
        <iframe src="${escHtml(file)}" width="100%" height="600px"></iframe>
      `;
    }
  })
}

const modalChangeFileName = document.querySelector("#modalChangeFileName");
if(modalChangeFileName) {
  const form = modalChangeFileName.querySelector("form");

  const INVALID_FILE_CHARS = /[/\\:*?"<>|]/;

  const changeFileNameValidator = new JustValidate('#formChangeFileName', { validateBeforeSubmitting: true });
  changeFileNameValidator
    .addField('#newFileName', [
      { rule: 'required', errorMessage: 'Please enter a file name!' },
      { rule: 'maxLength', value: 255, errorMessage: 'File name cannot exceed 255 characters!' },
      {
        validator: (value) => !INVALID_FILE_CHARS.test(value),
        errorMessage: 'Cannot contain: / \\ : * ? " < > |'
      }
    ])
    .onSuccess(() => {
      const folder = form.fileFolder.value;
      const oldFileName = form.oldFileName.value;
      const newFileName = form.newFileName.value.trim();

      if (oldFileName === newFileName) { bootstrap.Modal.getInstance(modalChangeFileName).hide(); return; }

      const formData = new FormData();
      formData.append("folder", folder);
      formData.append("oldFileName", oldFileName);
      formData.append("newFileName", newFileName);

      fetch(`/${pathAdmin}/api/files/name`, {
        method: "PATCH",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if (data.code === "error") { notyf.error(data.message); return; }
          bootstrap.Modal.getInstance(modalChangeFileName).hide();
          drawNotify("success", data.message);
          location.reload();
        })
        .catch(() => notyf.error("An error occurred while renaming the file."));
    });

  document.querySelectorAll("[button-change-file-name]").forEach(button => {
    button.addEventListener("click", () => {
      // Populate before the modal opens so its animation cannot overwrite typing.
      form.fileFolder.value = button.getAttribute("data-file-folder");
      form.oldFileName.value = button.getAttribute("data-file-name");
      form.newFileName.value = form.oldFileName.value;
    });
  });

  modalChangeFileName.addEventListener('shown.bs.modal', () => {
    form.querySelector('#newFileName').select();
  });

  modalChangeFileName.addEventListener('hidden.bs.modal', () => {
    form.fileFolder.value = "";
    form.oldFileName.value = "";
    form.newFileName.value = "";
    changeFileNameValidator.refresh();
  });
}

const listButtonDeleteFile = document.querySelectorAll("[button-delete-file]");
if(listButtonDeleteFile.length > 0) {
  listButtonDeleteFile.forEach(button => {
    button.addEventListener("click", () => {
      const folder = button.getAttribute("data-file-folder");
      const fileName = button.getAttribute("data-file-name");

      showConfirm({
        title: "Delete File",
        message: `Delete "${fileName}"? This action cannot be undone.`,
        onOk: () => {
          fetch(`/${pathAdmin}/api/files?folder=${encodeURIComponent(folder)}&fileName=${encodeURIComponent(fileName)}`, {
            method: "DELETE"
          })
            .then(res => res.json())
            .then(data => {
              if(data.code == "error") notyf.error(data.message);
              if(data.code == "success") { drawNotify(data.code, data.message); location.reload(); }
            })
        }
      })
    })
  })
}

const formCreateFolder = document.querySelector("#formCreateFolder");
if(formCreateFolder) {
  const INVALID_FOLDER_CHARS = /[/\\:*?"<>|]|\.\./;
  new JustValidate('#formCreateFolder')
    .addField('#folderNameInput', [
      { rule: 'required', errorMessage: 'Please enter folder name!' },
      {
        validator: (value) => !INVALID_FOLDER_CHARS.test(value),
        errorMessage: 'Cannot contain: / \\ : * ? " < > |'
      }
    ])
    .onSuccess((event) => {
      const folderName = event.target.folderName.value.trim();
      const formData = new FormData();
      formData.append("folderName", folderName);

      const urlParams = new URLSearchParams(window.location.search);
      const folderPath = urlParams.get("folderPath");
      if(folderPath) formData.append("folderPath", folderPath);

      fetch(`/${pathAdmin}/api/folders`, {
        method: "POST",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") notyf.error(data.message);
          if(data.code == "success") { drawNotify(data.code, data.message); location.reload(); }
        });
    });
}

const listButtonToFolder = document.querySelectorAll("[button-to-folder]");
if(listButtonToFolder.length > 0) {
  const url = new URL(window.location.href);

  listButtonToFolder.forEach(button => {
    button.addEventListener("click", () => {
      let folderPath = button.getAttribute("data-folder-path");
      if(folderPath) {
        const urlParams = new URLSearchParams(window.location.search);
        const folderPathCurrent = urlParams.get("folderPath");
        if(folderPathCurrent) {
          folderPath = `${folderPathCurrent}/${folderPath}`;
        }
        url.searchParams.set("folderPath", folderPath);
      } else {
        url.searchParams.delete("folderPath");
      }
      window.location.href = url.href;
    })
  })
}

const breadcumbFolder = document.querySelector("[breadcumb-folder]");
if(breadcumbFolder) {
  const urlParams = new URLSearchParams(window.location.search);
  const folderPath = urlParams.get("folderPath") || "";
  const listFolder = folderPath ? folderPath.split("/") : [];

  let htmls = `
    <li class="list-group-item bg-white">
      <a href="/${pathAdmin}/file-manager">
        <i class="la la-home text-info me-1"></i>
        Media
      </a>
    </li>
  `;

  let path = "";
  listFolder.forEach((item, index) => {
    path += (index > 0 ? "/" : "") + item;
    const isLast = index === listFolder.length - 1;
    htmls += `
      <li class="list-group-item bg-white ${isLast ? "fw-semibold" : ""}">
        <i class="la la-angle-right text-muted me-1"></i>
        ${isLast
          ? `<span class="text-dark">${escHtml(item)}</span>`
          : `<a href="/${pathAdmin}/file-manager?folderPath=${encodeURIComponent(path)}">${escHtml(item)}</a>`
        }
      </li>
    `;
  });
  breadcumbFolder.innerHTML = htmls;
}

const listButtonDeleteFolder = document.querySelectorAll("[button-delete-folder]");
if(listButtonDeleteFolder.length > 0) {
  listButtonDeleteFolder.forEach(button => {
    button.addEventListener("click", () => {
      const urlParams = new URLSearchParams(window.location.search);
      const folderPath = urlParams.get("folderPath") || "";
      const folderName = button.getAttribute("data-folder-name");
      let folderFinal = "/media";
      if(folderPath) {
        folderFinal += `/${folderPath}`;
      }
      if(folderName) {
        folderFinal += `/${folderName}`;
      }
      showConfirm({
        title: "Delete Folder",
        message: `Delete folder "${folderName}" and all its contents?`,
        onOk: () => {
          fetch(`/${pathAdmin}/api/folders?folderPath=${folderFinal}`, {
            method: "DELETE"
          })
            .then(res => res.json())
            .then(data => {
              if(data.code == "error") {
                notyf.error(data.message);
              }

              if(data.code == "success") {
                drawNotify("success", data.message);
                location.reload();
              }
            })
        }
      })
    })
  })
}

const modalRenameFolder = document.querySelector("#modalRenamefolder");
const formRenameFolder = document.querySelector("#formRenameFolder");
if (modalRenameFolder && formRenameFolder) {
  const INVALID_FOLDER_CHARS = /[/\\:*?"<>|]|\.\./;

  const renameFolderValidator = new JustValidate('#formRenameFolder', { validateBeforeSubmitting: true });
  renameFolderValidator
    .addField('#newFolderName', [
      { rule: 'required', errorMessage: 'Please enter a folder name!' },
      {
        validator: (value) => !INVALID_FOLDER_CHARS.test(value),
        errorMessage: 'Cannot contain: / \\ : * ? " < > |'
      }
    ])
    .onSuccess(() => {
      const oldFolderName = formRenameFolder.oldFolderName.value;
      const newFolderName = formRenameFolder.newFolderName.value.trim();

      if (oldFolderName === newFolderName) { bootstrap.Modal.getInstance(modalRenameFolder).hide(); return; }

      const urlParams = new URLSearchParams(window.location.search);
      const currentPath = urlParams.get("folderPath") || "";
      let folderPath = "/media";
      if (currentPath) folderPath += `/${currentPath}`;
      folderPath += `/${oldFolderName}`;

      const formData = new FormData();
      formData.append("folderPath", folderPath);
      formData.append("newFolderName", newFolderName);

      fetch(`/${pathAdmin}/api/folders/name`, {
        method: "PATCH",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if (data.code === "error") { notyf.error(data.message); return; }
          bootstrap.Modal.getInstance(modalRenameFolder).hide();
          drawNotify("success", data.message);
          location.reload();
        })
        .catch(() => notyf.error("An error occurred while renaming the folder."));
    });

  document.querySelectorAll("[button-rename-folder]").forEach(button => {
    button.addEventListener("click", () => {
      const name = button.getAttribute("data-folder-name");
      formRenameFolder.oldFolderName.value = name;
      formRenameFolder.newFolderName.value = name;
    });
  });

  modalRenameFolder.addEventListener("hidden.bs.modal", () => {
    formRenameFolder.oldFolderName.value = "";
    formRenameFolder.newFolderName.value = "";
    renameFolderValidator.refresh();
  });

  modalRenameFolder.addEventListener("shown.bs.modal", () => {
    formRenameFolder.newFolderName.select();
  });
}

const pasteContainer = document.querySelector("#paste-container");
const cuttingItemName = document.querySelector("#cutting-item-name");
const cuttingItemType = document.querySelector("#cutting-item-type");
const buttonPasteItem = document.querySelector("[button-paste-item]");

function clearCutState() {
  sessionStorage.removeItem("cutFileFolder");
  sessionStorage.removeItem("cutFileName");
  sessionStorage.removeItem("cutFolderPath");
  if (pasteContainer) pasteContainer.classList.add("d-none");
  if (cuttingItemName) cuttingItemName.textContent = "";
}

function showCutBanner(name, type) {
  if (!pasteContainer || !cuttingItemName || !cuttingItemType) return;
  cuttingItemName.textContent = name;
  cuttingItemType.textContent = type === "folder" ? "FOLDER" : "FILE";
  pasteContainer.classList.remove("d-none");
}

if (pasteContainer) {
  const savedFileFolder = sessionStorage.getItem("cutFileFolder");
  const savedFileName = sessionStorage.getItem("cutFileName");
  const savedFolderPath = sessionStorage.getItem("cutFolderPath");

  if (savedFileFolder && savedFileName) {
    showCutBanner(savedFileName, "file");
  } else if (savedFolderPath) {
    const name = savedFolderPath.split("/").filter(Boolean).pop() || savedFolderPath;
    showCutBanner(name, "folder");
  }

  document.querySelectorAll("[button-cut-file]").forEach(button => {
    button.addEventListener("click", () => {
      const folder = button.getAttribute("data-file-folder");
      const fileName = button.getAttribute("data-file-name");
      if (!folder || !fileName) return;
      clearCutState();
      sessionStorage.setItem("cutFileFolder", folder);
      sessionStorage.setItem("cutFileName", fileName);
      showCutBanner(fileName, "file");
      notyf.success(`"${fileName}" marked to move. Navigate to a folder and click Paste.`);
    });
  });

  document.querySelectorAll("[button-cut-folder]").forEach(button => {
    button.addEventListener("click", () => {
      const folderName = button.getAttribute("data-folder-name");
      if (!folderName) return;
      const urlParams = new URLSearchParams(window.location.search);
      const currentPath = urlParams.get("folderPath") || "";
      const fullPath = "/media" + (currentPath ? `/${currentPath}` : "") + `/${folderName}`;
      clearCutState();
      sessionStorage.setItem("cutFolderPath", fullPath);
      showCutBanner(folderName, "folder");
      notyf.success(`"${folderName}" marked to move. Navigate to a folder and click Paste.`);
    });
  });

  const buttonCancelCut = document.querySelector("[button-cancel-cut]");
  if (buttonCancelCut) {
    buttonCancelCut.addEventListener("click", () => {
      clearCutState();
      notyf.success("Cut cancelled.");
    });
  }

  if (buttonPasteItem) {
    buttonPasteItem.addEventListener("click", () => {
      const urlParams = new URLSearchParams(window.location.search);
      const targetFolder = urlParams.get("folderPath") || "";
      const targetFolderFull = "/media" + (targetFolder ? `/${targetFolder}` : "");

      const cutFolderPath = sessionStorage.getItem("cutFolderPath");
      if (cutFolderPath) {
        const formData = new FormData();
        formData.append("folderPath", cutFolderPath);
        formData.append("targetFolder", targetFolderFull);

        fetch(`/${pathAdmin}/api/folders/location`, {
          method: "PATCH",
          body: formData
        })
          .then(res => res.json())
          .then(data => {
            if (data.code === "error") { notyf.error(data.message); return; }
            clearCutState();
            drawNotify("success", data.message);
            location.reload();
          })
          .catch(() => notyf.error("An error occurred while moving the folder."));
        return;
      }

      const folder = sessionStorage.getItem("cutFileFolder");
      const fileName = sessionStorage.getItem("cutFileName");
      if (!folder || !fileName) { notyf.error("Nothing selected to move."); return; }

      const formData = new FormData();
      formData.append("folder", folder);
      formData.append("fileName", fileName);
      formData.append("targetFolder", targetFolder);

      fetch(`/${pathAdmin}/api/files/location`, {
        method: "PATCH",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if (data.code === "error") { notyf.error(data.message); return; }
          clearCutState();
          drawNotify("success", data.message);
          location.reload();
        })
        .catch(() => notyf.error("An error occurred while moving the file."));
    });
  }
}

let activeInputFile = null;
let activeMultiFileList = null;

const listFormGroupFile = document.querySelectorAll("[form-group-file]");
if(listFormGroupFile.length > 0) {
  listFormGroupFile.forEach(formGroupFile => {
    const inputFile = formGroupFile.querySelector("[input-file]");
    const previewFile = formGroupFile.querySelector("[preview-file]");
    const selectButton = formGroupFile.querySelector("[data-bs-target='#modalFileManager']");
    const previewImg = previewFile ? previewFile.querySelector("img") : null;

    const updatePreview = () => {
      if (!previewFile || !previewImg) return;
      const val = inputFile ? inputFile.value.trim() : "";
      if (val) {
        previewImg.src = val.startsWith("http") ? val : `${domainCDN}${val}`;
        previewFile.classList.remove("d-none");
      } else {
        previewImg.removeAttribute("src");
        previewFile.classList.add("d-none");
      }
    };

    if (inputFile) {
      inputFile.addEventListener("input", updatePreview);
    }

    if(selectButton) {
      selectButton.addEventListener("click", () => {
        activeInputFile = inputFile;
        activeMultiFileList = null;
      });
    }

    updatePreview();
  });
}

const listFormMultiFile = document.querySelectorAll(".form-multi-file");
if(listFormMultiFile.length > 0) {
  listFormMultiFile.forEach(formMultiFile => {
    const selectButton = formMultiFile.querySelector("[data-bs-target='#modalFileManager']");
    const innerList = formMultiFile.querySelector(".inner-list-image");
    if(selectButton && innerList) {
      selectButton.addEventListener("click", () => {
        activeMultiFileList = innerList;
        activeInputFile = null;
      })
    }
  })
}

const fileManagerModal = document.querySelector("#modalFileManager");
let fileManagerOpening = false;
let fileManagerClosePending = false;
const closeFileManager = () => {
  if (!fileManagerModal) return;
  if (fileManagerOpening) {
    fileManagerClosePending = true;
    return;
  }
  bootstrap.Modal.getInstance(fileManagerModal)?.hide();
};
fileManagerModal?.addEventListener("show.bs.modal", () => {
  fileManagerOpening = true;
  fileManagerClosePending = false;
});
fileManagerModal?.addEventListener("shown.bs.modal", () => {
  fileManagerOpening = false;
  if (fileManagerClosePending) {
    fileManagerClosePending = false;
    closeFileManager();
  }
});
fileManagerModal?.addEventListener("hidden.bs.modal", () => {
  fileManagerOpening = false;
  fileManagerClosePending = false;
});

window.addEventListener("message", (event) => {
  if(event.origin !== window.location.origin) return;
  if(!event.data || typeof event.data.fileLink !== "string" || !event.data.fileLink) return;

  if(window.activeTinyMCECallback) {
    const link = `${domainCDN}${event.data.fileLink}`;
    window.activeTinyMCECallback(link);
    closeFileManager();
    window.activeTinyMCECallback = null;
  } else if(activeInputFile) {
    activeInputFile.value = event.data.fileLink;
    activeInputFile.dispatchEvent(new Event("input"));
    closeFileManager();
    activeInputFile = null;
  } else if(activeMultiFileList) {
    const link = event.data.fileLink;
    activeMultiFileList.insertAdjacentHTML("beforeend", `
      <div class="inner-image">
        <img src="${escHtml(domainCDN + link)}" alt="" src-relative="${escHtml(link)}">
        <span class="inner-remove">x</span>
      </div>
    `);
    closeFileManager();
    activeMultiFileList = null;
  }
})

const getCheckboxList = (name) => {
  const checkboxList = document.querySelector(`[checkbox-list="${name}"]`);
  const inputList = checkboxList.querySelectorAll(`input[type="checkbox"]:checked`);
  const idList = [];
  inputList.forEach(input => {
    const id = input.value;
    if(id) {
      idList.push(id);
    }
  })
  return idList;
}

const getMultiFile = (name) => {
  const boxMultiFile = document.querySelector(`[multi-file="${name}"]`);
  const listImage = boxMultiFile.querySelectorAll(`img[src-relative]`);
  const listLink = [];
  listImage.forEach(image => {
    const link = image.getAttribute("src-relative");
    if(link) {
      listLink.push(link);
    }
  })
  return listLink;
}

const getOptionList = (name) => {
  const optionList = document.querySelectorAll(`[box-option="${name}"] .option-list .option-item`);
  const dataFinal = [];

  optionList.forEach(item => {
    const label = item.querySelector(".option-label").value;
    const value = item.querySelector(".option-value").value;
    if(label && value) {
      dataFinal.push({
        label: label,
        value: value
      });
    }
  })

  return dataFinal;
}

const articleCreateForm = document.querySelector("#articleCreateForm");
if(articleCreateForm) {
  const validation = new JustValidate('#articleCreateForm');

  validation
    .addField('#name', [
      {
        rule: 'required',
        errorMessage: 'Please enter article title!'
      }
    ])
    .addField('#slug', [
      {
        rule: 'required',
        errorMessage: 'Please enter slug!'
      }
    ])
    .onSuccess((event) => {
      const name = event.target.name.value;
      const slug = event.target.slug.value;
      const category = getCheckboxList("category");
      const status = event.target.status.value;
      const avatar = event.target.avatar.value;
      const description = tinymce.get("description").getContent();
      const content = tinymce.get("content").getContent();

      const formData = new FormData();
      formData.append("name", name);
      formData.append("slug", slug);
      formData.append("category", JSON.stringify(category));
      formData.append("status", status);
      formData.append("avatar", avatar);
      formData.append("description", description);
      formData.append("content", content);
      formData.append("author", event.target.author ? event.target.author.value : "");
      formData.append("sourceUrl", event.target.sourceUrl ? event.target.sourceUrl.value : "");

      fetch(`/${pathAdmin}/api/articles`, {
        method: "POST",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            drawNotify("success", data.message);
            location.reload();
          }
        })
    })
  ;
}

const articleEditForm = document.querySelector("#articleEditForm");
if(articleEditForm) {
  const validation = new JustValidate('#articleEditForm');

  validation
    .addField('#name', [
      {
        rule: 'required',
        errorMessage: 'Please enter article title!'
      }
    ])
    .addField('#slug', [
      {
        rule: 'required',
        errorMessage: 'Please enter slug!'
      }
    ])
    .onSuccess((event) => {
      const id = event.target.id.value;
      const name = event.target.name.value;
      const slug = event.target.slug.value;
      const category = getCheckboxList("category");
      const status = event.target.status.value;
      const avatar = event.target.avatar.value;
      const description = tinymce.get("description").getContent();
      const content = tinymce.get("content").getContent();

      const formData = new FormData();
      formData.append("name", name);
      formData.append("slug", slug);
      formData.append("category", JSON.stringify(category));
      formData.append("status", status);
      formData.append("avatar", avatar);
      formData.append("description", description);
      formData.append("content", content);
      formData.append("author", event.target.author ? event.target.author.value : "");
      formData.append("sourceUrl", event.target.sourceUrl ? event.target.sourceUrl.value : "");

      fetch(`/${pathAdmin}/api/articles/${id}`, {
        method: "PATCH",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            notyf.success(data.message);
          }
        })
    })
  ;
}

const roleCreateForm = document.querySelector("#roleCreateForm");
if(roleCreateForm) {
  const validation = new JustValidate('#roleCreateForm');

  validation
    .addField('#name', [
      {
        rule: 'required',
        errorMessage: 'Please enter role name!'
      }
    ])
    .onSuccess((event) => {
      const name = event.target.name.value;
      const description = event.target.description.value;
      const permissions = getCheckboxList("permissions");
      const status = event.target.status.value;

      const formData = new FormData();
      formData.append("name", name);
      formData.append("description", description);
      formData.append("permissions", JSON.stringify(permissions));
      formData.append("status", status);

      fetch(`/${pathAdmin}/api/roles`, {
        method: "POST",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            drawNotify("success", data.message);
            location.reload();
          }
        })
    })
  ;
}

const roleEditForm = document.querySelector("#roleEditForm");
if(roleEditForm) {
  const validation = new JustValidate('#roleEditForm');

  validation
    .addField('#name', [
      {
        rule: 'required',
        errorMessage: 'Please enter role name!'
      }
    ])
    .onSuccess((event) => {
      const id = event.target.id.value;
      const name = event.target.name.value;
      const description = event.target.description.value;
      const permissions = getCheckboxList("permissions");
      const status = event.target.status.value;

      const formData = new FormData();
      formData.append("name", name);
      formData.append("description", description);
      formData.append("permissions", JSON.stringify(permissions));
      formData.append("status", status);

      fetch(`/${pathAdmin}/api/roles/${id}`, {
        method: "PATCH",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            notyf.success(data.message);
          }
        })
    })
  ;
}

const accountAdminCreateForm = document.querySelector("#accountAdminCreateForm");
if(accountAdminCreateForm) {
  const validation = new JustValidate('#accountAdminCreateForm');

  validation
    .addField('#fullName', [
      {
        rule: 'required',
        errorMessage: 'Please enter your full name!'
      },
      {
        rule: 'minLength',
        value: 5,
        errorMessage: 'Full name must be at least 5 characters long!',
      },
      {
        rule: 'maxLength',
        value: 50,
        errorMessage: 'Full name cannot exceed 50 characters!',
      },
    ])
    .addField('#email', [
      {
        rule: 'required',
        errorMessage: 'Please enter your email!',
      },
      {
        rule: 'email',
        errorMessage: 'Invalid email address format!',
      },
    ])
    .addField('#password', [
      {
        rule: 'required',
        errorMessage: 'Please enter password!',
      },
      {
        validator: (value) => value.length >= 8,
        errorMessage: 'Password must be at least 8 characters long!',
      },
      {
        validator: (value) => /[A-Z]/.test(value),
        errorMessage: 'Password must contain at least one uppercase letter!',
      },
      {
        validator: (value) => /[a-z]/.test(value),
        errorMessage: 'Password must contain at least one lowercase letter!',
      },
      {
        validator: (value) => /\d/.test(value),
        errorMessage: 'Password must contain at least one digit!',
      },
      {
        validator: (value) => /[@$!%*?&]/.test(value),
        errorMessage: 'Password must contain at least one special character!',
      },
    ])
    .onSuccess((event) => {
      const fullName = event.target.fullName.value;
      const email = event.target.email.value;
      const password = event.target.password.value;
      const status = event.target.status.value;
      const avatar = event.target.avatar.value;
      const roles = getCheckboxList("roles");

      const formData = new FormData();
      formData.append("fullName", fullName);
      formData.append("email", email);
      formData.append("password", password);
      formData.append("status", status);
      formData.append("avatar", avatar);
      formData.append("roles", JSON.stringify(roles));

      fetch(`/${pathAdmin}/api/admin-accounts`, {
        method: "POST",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            drawNotify("success", data.message);
            location.reload();
          }
        })
    })
  ;
}

const accountAdminEditForm = document.querySelector("#accountAdminEditForm");
if(accountAdminEditForm) {
  const validation = new JustValidate('#accountAdminEditForm');

  validation
    .addField('#fullName', [
      {
        rule: 'required',
        errorMessage: 'Please enter your full name!'
      },
      {
        rule: 'minLength',
        value: 5,
        errorMessage: 'Full name must be at least 5 characters long!',
      },
      {
        rule: 'maxLength',
        value: 50,
        errorMessage: 'Full name cannot exceed 50 characters!',
      },
    ])
    .addField('#email', [
      {
        rule: 'required',
        errorMessage: 'Please enter your email!',
      },
      {
        rule: 'email',
        errorMessage: 'Invalid email address format!',
      },
    ])
    .onSuccess((event) => {
      const id = event.target.id.value;
      const fullName = event.target.fullName.value;
      const email = event.target.email.value;
      const status = event.target.status.value;
      const avatar = event.target.avatar.value;
      const roles = getCheckboxList("roles");

      const formData = new FormData();
      formData.append("fullName", fullName);
      formData.append("email", email);
      formData.append("status", status);
      formData.append("avatar", avatar);
      formData.append("roles", JSON.stringify(roles));

      fetch(`/${pathAdmin}/api/admin-accounts/${id}`, {
        method: "PATCH",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            notyf.success(data.message);
          }
        })
    })
  ;
}

const accountAdminChangePasswordForm = document.querySelector("#accountAdminChangePasswordForm");
if(accountAdminChangePasswordForm) {
  const validation = new JustValidate('#accountAdminChangePasswordForm');

  validation
    .addField('#password', [
      {
        rule: 'required',
        errorMessage: 'Please enter password!',
      },
      {
        validator: (value) => value.length >= 8,
        errorMessage: 'Password must be at least 8 characters long!',
      },
      {
        validator: (value) => /[A-Z]/.test(value),
        errorMessage: 'Password must contain at least one uppercase letter!',
      },
      {
        validator: (value) => /[a-z]/.test(value),
        errorMessage: 'Password must contain at least one lowercase letter!',
      },
      {
        validator: (value) => /\d/.test(value),
        errorMessage: 'Password must contain at least one digit!',
      },
      {
        validator: (value) => /[@$!%*?&]/.test(value),
        errorMessage: 'Password must contain at least one special character!',
      },
    ])
    .onSuccess((event) => {
      const id = event.target.id.value;
      const password = event.target.password.value;

      const formData = new FormData();
      formData.append("password", password);

      fetch(`/${pathAdmin}/api/admin-accounts/${id}/password`, {
        method: "PUT",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            notyf.success(data.message);
          }
        })
    })
  ;
}

const accountLoginForm = document.querySelector("#accountLoginForm");
if(accountLoginForm) {
  const validation = new JustValidate('#accountLoginForm');

  validation
    .addField('#email', [
      {
        rule: 'required',
        errorMessage: 'Please enter your email!',
      },
      {
        rule: 'email',
        errorMessage: 'Invalid email address format!',
      },
    ])
    .addField('#password', [
      {
        rule: 'required',
        errorMessage: 'Please enter password!',
      }
    ])
    .onSuccess((event) => {
      const email = event.target.email.value;
      const password = event.target.password.value;
      const rememberPassword = event.target.rememberPassword.checked;

      const formData = new FormData();
      formData.append("email", email);
      formData.append("password", password);
      formData.append("rememberPassword", rememberPassword);

      fetch(`/${pathAdmin}/api/sessions`, {
        method: "POST",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            drawNotify("success", data.message);
            location.href = `/${pathAdmin}/dashboard`;
          }
        })
    })
  ;
}

const productCreateCategoryForm = document.querySelector("#productCreateCategoryForm");
if(productCreateCategoryForm) {
  const validation = new JustValidate('#productCreateCategoryForm');

  validation
    .addField('#name', [
      {
        rule: 'required',
        errorMessage: 'Please enter category name!'
      }
    ])
    .addField('#slug', [
      {
        rule: 'required',
        errorMessage: 'Please enter slug!'
      }
    ])
    .onSuccess((event) => {
      const name = event.target.name.value;
      const slug = event.target.slug.value;
      const parent = event.target.parent.value;
      const status = event.target.status.value;
      const avatar = event.target.avatar.value;
      const description = tinymce.get("description").getContent();

      const formData = new FormData();
      formData.append("name", name);
      formData.append("slug", slug);
      formData.append("parent", parent);
      formData.append("status", status);
      formData.append("avatar", avatar);
      formData.append("description", description);

      fetch(`/${pathAdmin}/api/product-categories`, {
        method: "POST",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            drawNotify("success", data.message);
            location.reload();
          }
        })
    })
  ;
}

const productEditCategoryForm = document.querySelector("#productEditCategoryForm");
if(productEditCategoryForm) {
  const validator = new JustValidate('#productEditCategoryForm');

  validator
    .addField('#name', [
      {
        rule: 'required',
        errorMessage: 'Please enter category name!',
      },
    ])
    .addField('#slug', [
      {
        rule: 'required',
        errorMessage: 'Please enter slug!',
      },
    ])
    .onSuccess((event) => {
      const id = event.target.id.value;
      const name = event.target.name.value;
      const slug = event.target.slug.value;
      const parent = event.target.parent.value;
      const status = event.target.status.value;
      const avatar = event.target.avatar.value;
      const description = tinymce.get("description").getContent();

      const formData = new FormData();
      formData.append("name", name);
      formData.append("slug", slug);
      formData.append("parent", parent);
      formData.append("status", status);
      formData.append("avatar", avatar);
      formData.append("description", description);

      fetch(`/${pathAdmin}/api/product-categories/${id}`, {
        method: "PATCH",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            notyf.success(data.message);
          }
        })
    });
}

const productCreateForm = document.querySelector("#productCreateForm");
if(productCreateForm) {
  const validation = new JustValidate('#productCreateForm');

  validation
    .addField('#name', [
      {
        rule: 'required',
        errorMessage: 'Please enter product name!'
      }
    ])
    .addField('#slug', [
      {
        rule: 'required',
        errorMessage: 'Please enter slug!'
      }
    ])
    .onSuccess((event) => {
      const name = event.target.name.value;
      const slug = event.target.slug.value;
      const position = event.target.position.value;
      const status = event.target.status.value;
      const category = getCheckboxList("category");
      const description = tinymce.get("description").getContent();
      const content = tinymce.get("content").getContent();
      const images = getMultiFile("images");
      const priceOld = event.target.priceOld.value;
      const priceNew = event.target.priceNew.value;
      const stock = event.target.stock.value;
      const weight = event.target.weight ? event.target.weight.value : "";
      const attributes = getCheckboxList("attributes");

      const variants = [];
      const listTr = document.querySelectorAll("[variant-table] tbody tr");
      listTr.forEach(tr => {
        const status = tr.querySelector("input.form-check-input").checked;
        const attributeValue = JSON.parse(tr.querySelector("[attribute-value]").value);
        let priceOld = tr.querySelector("[price-old]").value;
        if(priceOld) {
          priceOld = parseInt(priceOld);
        }
        let priceNew = tr.querySelector("[price-new]").value;
        if(priceNew) {
          priceNew = parseInt(priceNew);
        } else {
          priceNew = priceOld;
        }
        let stock = tr.querySelector("[stock]").value;
        if(stock) {
          stock = parseInt(stock);
        } else {
          stock = 0;
        }
        variants.push({
          status: status,
          attributeValue: attributeValue,
          priceOld: priceOld,
          priceNew: priceNew,
          stock: stock,
        });
      })

      const selectTag = document.querySelector(`select[name="tags"]`);
      const tags = Array.from(selectTag.selectedOptions).map(option => option.value);

      const selectBoughtTogether = document.querySelector(`select[name="boughtTogether"]`);
      const boughtTogether = Array.from(selectBoughtTogether.selectedOptions).map(option => option.value);

      const formData = new FormData();
      formData.append("name", name);
      formData.append("slug", slug);
      formData.append("position", position);
      formData.append("status", status);
      formData.append("category", JSON.stringify(category));
      formData.append("description", description);
      formData.append("content", content);
      formData.append("images", JSON.stringify(images));
      formData.append("priceOld", priceOld);
      formData.append("priceNew", priceNew);
      formData.append("stock", stock);
      formData.append("weight", weight);
      formData.append("attributes", JSON.stringify(attributes));
      formData.append("variants", JSON.stringify(variants));
      formData.append("tags", JSON.stringify(tags));
      formData.append("boughtTogether", JSON.stringify(boughtTogether));

      fetch(`/${pathAdmin}/api/products`, {
        method: "POST",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            drawNotify("success", data.message);
            location.reload();
          }
        })
    })
  ;
}

const productEditForm = document.querySelector("#productEditForm");
if(productEditForm) {
  const validation = new JustValidate('#productEditForm');

  validation
    .addField('#name', [
      {
        rule: 'required',
        errorMessage: 'Please enter product name!'
      }
    ])
    .addField('#slug', [
      {
        rule: 'required',
        errorMessage: 'Please enter slug!'
      }
    ])
    .onSuccess((event) => {
      const id = event.target.id.value;
      const name = event.target.name.value;
      const slug = event.target.slug.value;
      const position = event.target.position.value;
      const status = event.target.status.value;
      const category = getCheckboxList("category");
      const description = tinymce.get("description").getContent();
      const content = tinymce.get("content").getContent();
      const images = getMultiFile("images");
      const priceOld = event.target.priceOld.value;
      const priceNew = event.target.priceNew.value;
      const stock = event.target.stock.value;
      const weight = event.target.weight ? event.target.weight.value : "";
      const attributes = getCheckboxList("attributes");

      const variants = [];
      const listTr = document.querySelectorAll("[variant-table] tbody tr");
      listTr.forEach(tr => {
        const status = tr.querySelector("input.form-check-input").checked;
        const attributeValue = JSON.parse(tr.querySelector("[attribute-value]").value);
        let priceOld = tr.querySelector("[price-old]").value;
        if(priceOld) {
          priceOld = parseInt(priceOld);
        }
        let priceNew = tr.querySelector("[price-new]").value;
        if(priceNew) {
          priceNew = parseInt(priceNew);
        } else {
          priceNew = priceOld;
        }
        let stock = tr.querySelector("[stock]").value;
        if(stock) {
          stock = parseInt(stock);
        } else {
          stock = 0;
        }
        variants.push({
          status: status,
          attributeValue: attributeValue,
          priceOld: priceOld,
          priceNew: priceNew,
          stock: stock,
        });
      })

      const selectTag = document.querySelector(`select[name="tags"]`);
      const tags = Array.from(selectTag.selectedOptions).map(option => option.value);

      const selectBoughtTogether = document.querySelector(`select[name="boughtTogether"]`);
      const boughtTogether = Array.from(selectBoughtTogether.selectedOptions).map(option => option.value);

      const formData = new FormData();
      formData.append("name", name);
      formData.append("slug", slug);
      formData.append("position", position);
      formData.append("status", status);
      formData.append("category", JSON.stringify(category));
      formData.append("description", description);
      formData.append("content", content);
      formData.append("images", JSON.stringify(images));
      formData.append("priceOld", priceOld);
      formData.append("priceNew", priceNew);
      formData.append("stock", stock);
      formData.append("weight", weight);
      formData.append("attributes", JSON.stringify(attributes));
      formData.append("variants", JSON.stringify(variants));
      formData.append("tags", JSON.stringify(tags));
      formData.append("boughtTogether", JSON.stringify(boughtTogether));

      fetch(`/${pathAdmin}/api/products/${id}`, {
        method: "PATCH",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            notyf.success(data.message);
          }
        })
    })
  ;
}

const listCheckboxInput = document.querySelectorAll(".checkbox-input");
if(listCheckboxInput.length > 0) {
  const inputCheckboxAll = document.querySelector(".checkbox-all");

  const updateBulkButtons = () => {
    const count = document.querySelectorAll(".checkbox-input:checked").length;
    const show = count > 0;
    [
      document.querySelector("[button-delete-many]"),
      document.querySelector("[button-soft-delete-many]"),
      document.querySelector("[button-restore-many]")
    ].forEach(btn => { if(btn) btn.style.display = show ? "" : "none"; });
  };

  if(inputCheckboxAll) {
    inputCheckboxAll.addEventListener("change", () => {
      listCheckboxInput.forEach(input => { input.checked = inputCheckboxAll.checked; });
      updateBulkButtons();
    });
  }

  listCheckboxInput.forEach(input => {
    input.addEventListener("change", () => {
      const checked = document.querySelectorAll(".checkbox-input:checked");
      if(inputCheckboxAll) inputCheckboxAll.checked = checked.length == listCheckboxInput.length;
      updateBulkButtons();
    });
  });
}

const bulkFetch = (button, method, suffix, confirmTitle, confirmMsg, okText = "Delete", okClass = "btn-danger") => {
  if(!button) return;
  button.addEventListener("click", () => {
    const checkedInputs = document.querySelectorAll(".checkbox-input:checked");
    if(checkedInputs.length === 0) return;
    const ids = Array.from(checkedInputs).map(input => input.value);
    const api = button.getAttribute("data-api") + suffix;
    showConfirm({
      title: confirmTitle,
      message: confirmMsg.replace("{n}", ids.length),
      okText: okText,
      okClass: okClass,
      onOk: () => {
        fetch(api, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids })
        })
          .then(res => res.json())
          .then(data => {
            if(data.code == "error") notyf.error(data.message);
            if(data.code == "success") { drawNotify("success", data.message); location.reload(); }
          });
      }
    });
  });
};

bulkFetch(
  document.querySelector("[button-delete-many]"),
  "DELETE",
  "",
  "Delete Permanently",
  "Permanently delete {n} item(s)? This cannot be undone.",
  "Delete",
  "btn-danger"
);

bulkFetch(
  document.querySelector("[button-soft-delete-many]"),
  "POST",
  "",
  "Move to Trash",
  "Move {n} item(s) to trash?",
  "Move to Trash",
  "btn-danger"
);

bulkFetch(
  document.querySelector("[button-restore-many]"),
  "POST",
  "/restore",
  "Restore",
  "Restore {n} item(s)?",
  "Restore",
  "btn-success"
);

const buttonCopyMulti = document.querySelector("[button-copy-multi]");
if(buttonCopyMulti) {
  buttonCopyMulti.addEventListener("click", () => {
    const listCheckboxInputChecked = document.querySelectorAll(".checkbox-input:checked");
    const listLink = [];
    listCheckboxInputChecked.forEach(input => {
      listLink.push(input.value);
    })
    navigator.clipboard.writeText(JSON.stringify(listLink));
    notyf.success("Copied!");
  })
}

const listButtonPaste = document.querySelectorAll("[button-paste]");
if(listButtonPaste) {
  listButtonPaste.forEach(buttonPaste => {
    const elementListImage = buttonPaste.closest(".form-multi-file").querySelector(".inner-list-image");

    buttonPaste.addEventListener("click", async () => {
      const listLinkJson = await navigator.clipboard.readText();
      let listLink;
      try {
        listLink = JSON.parse(listLinkJson);
      } catch {
        return;
      }
      if (!Array.isArray(listLink)) return;
      for (const link of listLink.filter((item) => typeof item === "string")) {
        elementListImage.insertAdjacentHTML("beforeend", `
          <div class="inner-image">
            <img src="${escHtml(domainCDN + link)}" alt="" src-relative="${escHtml(link)}">
            <span class="inner-remove">x</span>
          </div>
        `);
      }
    })

    new Sortable(elementListImage, {
      animation: 150
    });
  })
}

const listElementListImage = document.querySelectorAll(".form-multi-file .inner-list-image");
if(listElementListImage.length > 0) {
  listElementListImage.forEach(elementListImage => {
    elementListImage.addEventListener("click", (event) => {
      if(event.target.closest(".inner-remove")) {
        const parentItem = event.target.closest(".inner-image");
        if(parentItem) {
          parentItem.remove();
        }
      }
    })
  })
}

const boxOption = document.querySelector("[box-option]");
if(boxOption) {
  const optionList = boxOption.querySelector(".option-list");
  const optionCreate = boxOption.querySelector(".option-create");

  optionCreate.addEventListener("click", () => {
    const newItem = `
      <div class="option-item">
        <span class="btn btn-secondary option-move">
          <i class="fa-solid fa-up-down-left-right"></i>
        </span>
        <input class="form-control option-label" type="text" placeholder="Label">
        <input class="form-control option-value" type="text" placeholder="Value">
        <button type="button" class="btn btn-danger option-remove">Delete</button>
      </div>
    `;
    optionList.insertAdjacentHTML("beforeend", newItem);
  })

  optionList.addEventListener("click", (event) => {
    if(event.target.closest(".option-remove")) {
      const parentItem = event.target.closest(".option-item");
      if(parentItem) {
        parentItem.remove();
      }
    }
  })

  new Sortable(optionList, {
    animation: 150,
    handle: '.option-move',
  });
}

const productCreateAttributeForm = document.querySelector("#productCreateAttributeForm");
if(productCreateAttributeForm) {
  const validation = new JustValidate('#productCreateAttributeForm');

  validation
    .addField('#name', [
      {
        rule: 'required',
        errorMessage: 'Please enter attribute name!'
      }
    ])
    .onSuccess((event) => {
      const name = event.target.name.value;
      const type = event.target.type.value;
      const options = getOptionList("options");

      const formData = new FormData();
      formData.append("name", name);
      formData.append("type", type);
      formData.append("options", JSON.stringify(options));

      fetch(`/${pathAdmin}/api/product-attributes`, {
        method: "POST",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            drawNotify("success", data.message);
            location.reload();
          }
        })
    })
  ;
}

const productEditAttributeForm = document.querySelector("#productEditAttributeForm");
if(productEditAttributeForm) {
  const validation = new JustValidate('#productEditAttributeForm');

  validation
    .addField('#name', [
      {
        rule: 'required',
        errorMessage: 'Please enter attribute name!'
      }
    ])
    .onSuccess((event) => {
      const id = event.target.id.value;
      const name = event.target.name.value;
      const type = event.target.type.value;
      const options = getOptionList("options");

      const formData = new FormData();
      formData.append("name", name);
      formData.append("type", type);
      formData.append("options", JSON.stringify(options));

      fetch(`/${pathAdmin}/api/product-attributes/${id}`, {
        method: "PATCH",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            notyf.success(data.message);
          }
        })
    })
  ;
}

const generateVariants = (attributes) => {
  const optionList = attributes.map(attribute =>
    attribute.options.map(option => ({
      attrId: attribute._id,
      attrType: attribute.type,
      label: option.label,
      value: option.value,
    }))
  )

  const variantList = optionList.reduce((a, b) => a.flatMap(x => b.map(y => [...x, y])), [[]]);

  return variantList;
}

const buttonRenderVariant = document.querySelector("[button-render-variant]");
if(buttonRenderVariant) {
  buttonRenderVariant.addEventListener("click", () => {
    const attr = buttonRenderVariant.getAttribute("button-render-variant");
    const idList = getCheckboxList(attr);
    const attributeListChecked = attributeList.filter(item => idList.includes(item._id));
    const variantList = generateVariants(attributeListChecked);

    const variantTable = document.querySelector("[variant-table]");

    const variantHead = variantTable.querySelector("thead tr");
    let variantHeadHTML = "";
    variantHeadHTML += `
      <th scope="col">Status</th>
    `;
    attributeListChecked.forEach(item => {
      variantHeadHTML += `
        <th scope="col">${item.name}</th>
      `;
    })
    variantHeadHTML += `
      <th scope="col">Old Price</th>
      <th scope="col">New Price</th>
      <th scope="col">Stock</th>
    `;
    variantHead.innerHTML = variantHeadHTML;

    const variantBody = variantTable.querySelector("tbody");
    const priceOld = document.querySelector(`[name="priceOld"]`).value;
    const priceNew = document.querySelector(`[name="priceNew"]`).value;
    let variantBodyHTML = "";
    variantList.forEach(variant => {
      const variantJSON = JSON.stringify(variant).replaceAll(`"`, `&quot;`);
      const variantName = escHtml(variant.map(item => item.label).join(" / "));
      let tr = "<tr>";
      tr += `
        <td>
          <div class="form-check form-switch form-switch-success">
            <input class="form-check-input" type="checkbox" checked="" aria-label="Sell ${variantName}">
          </div>
          <input class="d-none" attribute-value value="${variantJSON}" />
        </td>
      `;
      variant.forEach(item => {
        tr += `
          <td>${escHtml(item.label)}</td>
        `;
      })
      tr += `
        <td>
          <input class="form-control" type="number" value="${priceOld}" price-old aria-label="Old price, ${variantName}">
        </td>
        <td>
          <input class="form-control" type="number" value="${priceNew}" price-new aria-label="New price, ${variantName}">
        </td>
        <td>
          <input class="form-control" type="number" stock aria-label="Stock, ${variantName}">
        </td>
      `;
      tr += "</tr>";
      variantBodyHTML += tr;
    })
    variantBody.innerHTML = variantBodyHTML;
  })
}

const listSelectTag = document.querySelectorAll("[select-tag]");
if(listSelectTag.length > 0) {
  listSelectTag.forEach(selectTag => {
    let taggable = selectTag.getAttribute("taggable");

    new Selectr(selectTag, {
      taggable: taggable == "false" ? false : true
    });

    // Selectr renders its trigger as a focusable div with aria-expanded but no role, plus a stray
    // disabled="undefined"; give it the combobox role and the original select's label.
    const container = selectTag.closest(".selectr-container");
    const trigger = container.querySelector(".selectr-selected");
    if(trigger) {
      if(trigger.getAttribute("disabled") === "undefined") trigger.removeAttribute("disabled");
      trigger.setAttribute("role", "combobox");
      trigger.setAttribute("aria-haspopup", "listbox");
      const label = (selectTag.id && document.querySelector(`label[for="${selectTag.id}"]`))
        || (container.previousElementSibling?.tagName === "LABEL" ? container.previousElementSibling : null);
      trigger.setAttribute("aria-label", label ? label.textContent.trim() : (selectTag.name || "Options"));

      // Tag remove buttons are created as tags are added; name each one after its tag.
      const nameRemoveButtons = () => container.querySelectorAll(".selectr-tag-remove:not([aria-label])").forEach(button => {
        const tagText = button.parentElement ? button.parentElement.firstChild?.textContent?.trim() : "";
        button.setAttribute("aria-label", `Remove ${tagText || "tag"}`);
      });
      nameRemoveButtons();
      new MutationObserver(nameRemoveButtons).observe(container, { childList: true, subtree: true });
    }

    const inputTag = container.querySelector(".selectr-tag-input");
    if(inputTag) {
      inputTag.setAttribute("aria-label", `Add to ${trigger?.getAttribute("aria-label") || "tags"}`);
      inputTag.addEventListener("keydown", (event) => {
        if(event.key == "Enter") {
          event.preventDefault();
        }
      });
    }
  })
}

const formImportExcel = document.querySelector("#formImportExcel");
if(formImportExcel) {
  const validation = new JustValidate('#formImportExcel');

  validation
    .addField('#file', [
      {
        rule: 'minFilesCount',
        value: 1,
        errorMessage: "Please select a CSV file",
      },
      {
        rule: "files",
        value: {
          files: {
            extensions: ['csv'],
            types: ['text/csv'],
          },
        },
        errorMessage: "Please select a valid CSV file",
      },
    ])
    .onSuccess((event) => {
      const fileInput = event.target.querySelector("#file");
      const file = fileInput.files[0];
      const api = formImportExcel.getAttribute("data-api");

      const formData = new FormData();
      formData.append("file", file);

      fetch(api, {
        method: "POST",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            drawNotify("success", data.message);
            location.reload();
          }
        })
    })
  ;
}

const dateRange = document.querySelector("[date-range]");
if(dateRange) {
  new DateRangePicker(dateRange, {
    format: 'dd/mm/yyyy'
  });
}

const couponCreateForm = document.querySelector("#couponCreateForm");
if(couponCreateForm) {
  const validation = new JustValidate('#couponCreateForm');

  validation
    .addField('#code', [
      {
        rule: 'required',
        errorMessage: 'Please enter coupon code!'
      }
    ])
    .addField('#name', [
      {
        rule: 'required',
        errorMessage: 'Please enter coupon name!'
      }
    ])
    .onSuccess((event) => {
      const code = event.target.code.value;
      const name = event.target.name.value;
      const typeDiscount = event.target.typeDiscount.value;
      const value = event.target.value.value;
      const minOrderValue = event.target.minOrderValue.value;
      const maxDiscountValue = event.target.maxDiscountValue.value;
      const usageLimit = event.target.usageLimit.value;
      const typeDisplay = event.target.typeDisplay.value;
      const status = event.target.status.value;
      const startDate = event.target.startDate.value;
      const endDate = event.target.endDate.value;
      const description = tinymce.get("description").getContent();

      const formData = new FormData();
      formData.append("code", code);
      formData.append("name", name);
      formData.append("typeDiscount", typeDiscount);
      formData.append("value", value);
      formData.append("minOrderValue", minOrderValue);
      formData.append("maxDiscountValue", maxDiscountValue);
      formData.append("usageLimit", usageLimit);
      formData.append("typeDisplay", typeDisplay);
      formData.append("status", status);
      formData.append("startDate", startDate);
      formData.append("endDate", endDate);
      formData.append("description", description);

      fetch(`/${pathAdmin}/api/coupons`, {
        method: "POST",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            drawNotify("success", data.message);
            location.reload();
          }
        })
    })
  ;
}

const couponEditForm = document.querySelector("#couponEditForm");
if(couponEditForm) {
  const validation = new JustValidate('#couponEditForm');

  validation
    .addField('#code', [
      {
        rule: 'required',
        errorMessage: 'Please enter coupon code!'
      }
    ])
    .addField('#name', [
      {
        rule: 'required',
        errorMessage: 'Please enter coupon name!'
      }
    ])
    .onSuccess((event) => {
      const id = event.target.id.value;
      const code = event.target.code.value;
      const name = event.target.name.value;
      const typeDiscount = event.target.typeDiscount.value;
      const value = event.target.value.value;
      const minOrderValue = event.target.minOrderValue.value;
      const maxDiscountValue = event.target.maxDiscountValue.value;
      const usageLimit = event.target.usageLimit.value;
      const typeDisplay = event.target.typeDisplay.value;
      const status = event.target.status.value;
      const startDate = event.target.startDate.value;
      const endDate = event.target.endDate.value;
      const description = tinymce.get("description").getContent();

      const formData = new FormData();
      formData.append("code", code);
      formData.append("name", name);
      formData.append("typeDiscount", typeDiscount);
      formData.append("value", value);
      formData.append("minOrderValue", minOrderValue);
      formData.append("maxDiscountValue", maxDiscountValue);
      formData.append("usageLimit", usageLimit);
      formData.append("typeDisplay", typeDisplay);
      formData.append("status", status);
      formData.append("startDate", startDate);
      formData.append("endDate", endDate);
      formData.append("description", description);

      fetch(`/${pathAdmin}/api/coupons/${id}`, {
        method: "PATCH",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            notyf.success(data.message);
          }
        })
    })
  ;
}

// Settings forms marked with data-setting-endpoint send every named field as JSON:
// number inputs as numbers, and checkbox groups ([data-array-field="name"]) as arrays.
document.querySelectorAll("form[data-setting-endpoint]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (window.tinymce) window.tinymce.triggerSave();

    const dataFinal = {};
    form.querySelectorAll("input[name], select[name], textarea[name]").forEach((field) => {
      if (field.type === "checkbox" || field.closest("[data-array-field]")) return;
      if (field.type === "number") {
        dataFinal[field.name] = field.value === "" ? "" : Number(field.value);
      } else {
        dataFinal[field.name] = field.value;
      }
    });
    form.querySelectorAll("[data-array-field]").forEach((group) => {
      dataFinal[group.dataset.arrayField] = [...group.querySelectorAll("input[type=checkbox]:checked")].map((box) => box.value);
    });

    fetch(`/${pathAdmin}/api/settings/${form.dataset.settingEndpoint}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dataFinal),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.code == "success") notyf.success(data.message);
        else notyf.error(data.message || "Update failed!");
      })
      .catch(() => notyf.error("Update failed!"));
  });
});

// Interactive Map & Store Location Picker for General Settings
if (document.querySelector("#boxMap") && typeof initLocationPicker === "function") {
  initLocationPicker({
    mapTarget: "#boxMap",
    searchInput: "#mapSearchInput",
    searchBtn: "#mapSearchBtn",
    suggestionsBox: "#addressSuggestions",
    addressInput: "#shopSenderAddress",
    latInput: "#shopLat",
    lngInput: "#shopLng",
    clearButton: "#mapClearPin"
  });
}

const settingApiLoginSocialForm = document.querySelector("#settingApiLoginSocialForm");
if(settingApiLoginSocialForm) {
  const validation = new JustValidate('#settingApiLoginSocialForm');

  validation
    .onSuccess((event) => {
      const googleClientId = event.target.googleClientId.value;
      const googleClientSecret = event.target.googleClientSecret.value;
      const googleCallbackUrl = event.target.googleCallbackUrl.value;
      const facebookAppId = event.target.facebookAppId.value;
      const facebookAppSecret = event.target.facebookAppSecret.value;
      const facebookCallbackUrl = event.target.facebookCallbackUrl.value;

      const dataFinal = {
        googleClientId: googleClientId,
        googleClientSecret: googleClientSecret,
        googleCallbackUrl: googleCallbackUrl,
        facebookAppId: facebookAppId,
        facebookAppSecret: facebookAppSecret,
        facebookCallbackUrl: facebookCallbackUrl,
      };

      fetch(`/${pathAdmin}/api/settings/social-login`, {
        method: "PATCH",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(dataFinal),
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            notyf.success(data.message);
          }
        })
    })
  ;
}

const settingApiAppPasswordForm = document.querySelector("#settingApiAppPasswordForm");
if(settingApiAppPasswordForm) {
  const validation = new JustValidate('#settingApiAppPasswordForm');

  validation
    .onSuccess((event) => {
      const gmailUser = event.target.gmailUser.value;
      const gmailPassword = event.target.gmailPassword.value;

      const dataFinal = {
        gmailUser: gmailUser,
        gmailPassword: gmailPassword,
      };

      fetch(`/${pathAdmin}/api/settings/email`, {
        method: "PATCH",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(dataFinal),
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            notyf.success(data.message);
          }
        })
    })
  ;
}

const orderEditForm = document.querySelector("#orderEditForm");
if (orderEditForm) {
  const validation = new JustValidate('#orderEditForm');

  validation
    .onSuccess((event) => {
      const id = event.target.id.value;
      const orderStatus = event.target.orderStatus.value;
      const paymentStatus = event.target.paymentStatus.value;
      const note = event.target.note.value;

      const data = {
        orderStatus: orderStatus,
        paymentStatus: paymentStatus,
        note: note
      };

      fetch(`/${pathAdmin}/api/orders/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
      })
        .then(res => res.json())
        .then(data => {
          if (data.code === "error") {
            notyf.error(data.message);
          }

          if (data.code === "success") {
            notyf.success(data.message);
          }
        })
        .catch(() => {
          notyf.error("An error occurred, please try again!");
        });
    });
}

[["#productEditSeoForm", "product"], ["#articleEditSeoForm", "article"]].forEach(([selector, entity]) => {
  if (!document.querySelector(selector)) return;
  const validation = new JustValidate(selector);

  validation
    .addField("#seoTitle", [
      {
        rule: "maxLength",
        value: 60,
        errorMessage: "SEO Title must be at most 60 characters!",
      },
    ])
    .addField("#seoDescription", [
      {
        rule: "maxLength",
        value: 160,
        errorMessage: "SEO Description must be at most 160 characters!",
      },
    ])
    .addField("#seoOgTitle", [
      {
        rule: "maxLength",
        value: 95,
        errorMessage: "OG Title must be at most 95 characters!",
      },
    ])
    .addField("#seoOgDescription", [
      {
        rule: "maxLength",
        value: 200,
        errorMessage: "OG Description must be at most 200 characters!",
      },
    ])
    .onSuccess((event) => {
      const id = event.target.id.value;
      const seoTitle = event.target.seoTitle.value;
      const seoDescription = event.target.seoDescription.value;
      const selectSeoKeywords = document.querySelector("select[name='seoKeywords']");
      const seoKeywords = Array.from(selectSeoKeywords.selectedOptions).map(opt => opt.value);

      const seoRobotsIndex = event.target.seoRobotsIndex.checked;
      const seoRobotsFollow = event.target.seoRobotsFollow.checked;

      const seoOgTitle = event.target.seoOgTitle.value;
      const seoOgImage = event.target.seoOgImage.value;
      const seoOgDescription = event.target.seoOgDescription.value;

      const formData = new FormData();
      formData.append("seoTitle", seoTitle);
      formData.append("seoDescription", seoDescription);
      formData.append("seoKeywords", JSON.stringify(seoKeywords));
      formData.append("seoRobotsIndex", seoRobotsIndex);
      formData.append("seoRobotsFollow", seoRobotsFollow);
      formData.append("seoOgTitle", seoOgTitle);
      formData.append("seoOgImage", seoOgImage);
      formData.append("seoOgDescription", seoOgDescription);

      fetch(`/${pathAdmin}/api/${entity}s/${id}/seo`, {
        method: "PATCH",
        body: formData,
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.code === "error") {
            notyf.error(data.message);
          }

          if (data.code === "success") {
            drawNotify("success", data.message);
            window.location.reload();
          }
        })
        .catch(() => {
          notyf.error("An error occurred, please try again!");
        });
    });});

const blockCreateForm = document.querySelector("#blockCreateForm");
if(blockCreateForm) {
  const validation = new JustValidate('#blockCreateForm');

  validation
    .addField('#name', [
      {
        rule: 'required',
        errorMessage: 'Please enter block name!'
      }
    ])
    .addField('#fileName', [
      {
        rule: 'required',
        errorMessage: 'Please select template file!'
      }
    ])
    .onSuccess((event) => {
      const name = event.target.name.value;
      const fileName = event.target.fileName.value;
      const status = event.target.status.value;

      let dataObject = {};
      try {
        dataObject = window.blockJsonEditor.get();
      } catch (error) {
        notyf.error("Invalid JSON data!");
        return;
      }

      const dataFinal = {
        name: name,
        fileName: fileName,
        status: status,
        data: dataObject
      };

      fetch(`/${pathAdmin}/api/blocks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(dataFinal)
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            drawNotify("success", data.message);
            location.reload();
          }
        })
    })
  ;
}

const blockEditForm = document.querySelector("#blockEditForm");
if(blockEditForm) {
  const validation = new JustValidate('#blockEditForm');

  validation
    .addField('#name', [
      {
        rule: 'required',
        errorMessage: 'Please enter block name!'
      }
    ])
    .addField('#fileName', [
      {
        rule: 'required',
        errorMessage: 'Please select template file!'
      }
    ])
    .onSuccess((event) => {
      const id = event.target.id.value;
      const name = event.target.name.value;
      const fileName = event.target.fileName.value;
      const status = event.target.status.value;

      let dataObject = {};
      try {
        dataObject = window.blockJsonEditor.get();
      } catch (error) {
        notyf.error("Invalid JSON data!");
        return;
      }

      const dataFinal = {
        name: name,
        fileName: fileName,
        status: status,
        data: dataObject
      };

      fetch(`/${pathAdmin}/api/blocks/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(dataFinal)
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            notyf.success(data.message);
          }
        })
    })
  ;
}

const blockSource = document.querySelector("#blockSource");
const blockTarget = document.querySelector("#blockTarget");
if(blockSource && blockTarget) {
  new Sortable(blockSource, {
    group: {
      name: 'blocks',
      pull: 'clone',
      put: false
    },
    animation: 150,
    sort: false
  });

  new Sortable(blockTarget, {
    group: 'blocks',
    animation: 150,
    onAdd: (event) => {
      const item = event.item;

      const buttonRemove = item.querySelector(".button-remove");
      buttonRemove.classList.remove("d-none");
      buttonRemove.addEventListener("click", () => {
        item.remove();
      })
    }
  });

  document.querySelectorAll("#blockTarget .list-group-item").forEach(item => {
    const buttonRemove = item.querySelector(".button-remove");
    buttonRemove.addEventListener("click", () => {
      item.remove();
    })
  });
}

const templateCreateForm = document.querySelector("#templateCreateForm");
if(templateCreateForm) {
  const validation = new JustValidate('#templateCreateForm');

  validation
    .addField('#name', [
      {
        rule: 'required',
        errorMessage: 'Please enter template name!'
      }
    ])
    .addField('#slug', [
      {
        rule: 'required',
        errorMessage: 'Please enter applied path for template!'
      }
    ])
    .onSuccess((event) => {
      const name = event.target.name.value;
      const slug = event.target.slug.value;
      const status = event.target.status.value;
      const blocks = [];

      const blockItems = document.querySelectorAll("#blockTarget .list-group-item");
      blockItems.forEach((item, index) => {
        const blockId = item.getAttribute("data-id");
        blocks.push({
          blockId: blockId,
          position: index
        });
      });

      const dataFinal = {
        name: name,
        slug: slug,
        blocks: blocks,
        status: status
      };

      fetch(`/${pathAdmin}/api/templates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(dataFinal)
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            drawNotify("success", data.message);
            location.reload();
          }
        })
    })
  ;
}

const templateEditForm = document.querySelector("#templateEditForm");
if(templateEditForm) {
  const validation = new JustValidate('#templateEditForm');

  validation
    .addField('#name', [
      {
        rule: 'required',
        errorMessage: 'Please enter template name!'
      }
    ])
    .addField('#slug', [
      {
        rule: 'required',
        errorMessage: 'Please enter applied path for template!'
      }
    ])
    .onSuccess((event) => {
      const id = event.target.id.value;
      const name = event.target.name.value;
      const slug = event.target.slug.value;
      const status = event.target.status.value;
      const blocks = [];

      const blockItems = document.querySelectorAll("#blockTarget .list-group-item");
      blockItems.forEach((item, index) => {
        const blockId = item.getAttribute("data-id");
        blocks.push({
          blockId: blockId,
          position: index
        });
      });

      const dataFinal = {
        name: name,
        slug: slug,
        blocks: blocks,
        status: status
      };

      fetch(`/${pathAdmin}/api/templates/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(dataFinal)
      })
        .then(res => res.json())
        .then(data => {
          if(data.code == "error") {
            notyf.error(data.message);
          }

          if(data.code == "success") {
            notyf.success(data.message);
          }
        })
    })
  ;
}
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.password-toggle');
  if (!btn) return;
  const input = btn.closest('.input-group').querySelector('input');
  if (!input) return;
  const icon = btn.querySelector('i');
  if (input.type === 'password') {
    input.type = 'text';
    icon.classList.replace('fa-eye', 'fa-eye-slash');
  } else {
    input.type = 'password';
    icon.classList.replace('fa-eye-slash', 'fa-eye');
  }
});

const checkAllEl = document.querySelector("[check-all]");
if(checkAllEl) {
  checkAllEl.addEventListener("change", () => {
    document.querySelectorAll("[check-item]").forEach(input => {
      input.checked = checkAllEl.checked;
    });
  });
  document.querySelectorAll("[check-item]").forEach(input => {
    input.addEventListener("change", () => {
      const total = document.querySelectorAll("[check-item]").length;
      const checked = document.querySelectorAll("[check-item]:checked").length;
      checkAllEl.checked = total === checked;
    });
  });
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-logout-admin]");
  if (!link) return;
  event.preventDefault();
  fetch(`/${pathAdmin}/api/sessions/current`, { method: "DELETE" }).finally(() => {
    window.location.href = `/${pathAdmin}/account/login`;
  });
});
