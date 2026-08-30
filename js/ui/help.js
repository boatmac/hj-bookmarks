/* In-app user help dialog. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

function openHelpDialog() {
    closeSidebar();
    if (!ui.helpDialog.open) ui.helpDialog.showModal();
}

function closeHelpDialog() {
    if (ui.helpDialog.open) ui.helpDialog.close();
}
