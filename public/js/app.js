document.addEventListener("DOMContentLoaded", () => {

    document
        .querySelectorAll("[data-confirm]")
        .forEach(button => {

            button.addEventListener("click", event => {

                const message =
                    button.dataset.confirm;

                if (!confirm(message)) {
                    event.preventDefault();
                }

            });

        });

});