/*
    SPDX-License-Identifier: MIT

    Widget settings registration. This file is loaded by the Plasma
    configuration dialog (where org.kde.plasma.configuration is
    available), NOT by the plasmoid itself — do not move it into
    contents/ui/main.qml.
*/

import QtQuick 2.0
import org.kde.plasma.configuration 2.0

ConfigModel {
    ConfigCategory {
        name: i18n("General")
        icon: "preferences-desktop"
        source: "config/ConfigGeneral.qml"
    }
}