/*
    SPDX-License-Identifier: MIT

    Config page (widget settings dialog). cfg_* properties are
    two-way bound to contents/config/main.xml by the plasmoid config
    machinery.
*/

import QtQuick 2.15
import QtQuick.Layouts 1.15
import QtQuick.Controls 2.15 as QQC2

import org.kde.plasma.core 2.1 as PlasmaCore
import org.kde.plasma.components 3.0 as PlasmaComponents3
import org.kde.kirigami 2.20 as Kirigami

ColumnLayout {
    id: page

    property alias cfg_showIcon: showIcon.checked
    property alias cfg_cliPath: cliPath.text
    property alias cfg_refreshInterval: refreshInterval.value

    Kirigami.FormLayout {
        twinFormLabelWidth: Math.round(PlasmaCore.Units.gridUnit * 8)

        QQC2.CheckBox {
            id: showIcon
            Kirigami.FormData.label: "Icon:"
            text: "Show the ollama icon in the status bar"
        }

        QQC2.SpinBox {
            id: refreshInterval
            Kirigami.FormData.label: "Refresh every:"
            from: 1
            to: 60
            editable: true
            textFromValue: function (value) {
                return value + " min";
            }
            valueFromText: function (text) {
                return parseInt(text) || 5;
            }
        }

        QQC2.TextField {
            id: cliPath
            Kirigami.FormData.label: "CLI path:"
            Layout.fillWidth: true
            placeholderText: "Auto-detect (repo checkout, PATH, ~/.local/bin)"
            ToolTip.visible: hovered
            ToolTip.text: "Absolute path to ollama-usage.js (the shared core, run with --json). Leave empty to auto-detect."
            horizontalAlignment: Text.AlignLeft
        }
    }

    PlasmaComponents3.Label {
        Layout.alignment: Qt.AlignHCenter
        text: "The CLI (../cli/) is the source of truth — this widget is a thin UI around it."
        color: Kirigami.Theme.disabledTextColor
    }
}