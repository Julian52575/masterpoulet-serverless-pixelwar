{{- define "pixelwar.labels" -}}
app.kubernetes.io/part-of: pixelwar
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{/* Selector labels for one component: pass (list $ "backend") */}}
{{- define "pixelwar.selector" -}}
app.kubernetes.io/name: pixelwar
app.kubernetes.io/instance: {{ (index . 0).Release.Name }}
app.kubernetes.io/component: {{ index . 1 }}
{{- end }}

{{- define "pixelwar.fullname" -}}
{{ .Release.Name }}
{{- end }}

{{- define "pixelwar.image" -}}
{{ .image.repository }}:{{ .image.tag | default .root.Chart.AppVersion }}
{{- end }}

{{- define "pixelwar.postgresHost" -}}
{{ if .Values.postgres.enabled }}{{ .Release.Name }}-postgres{{ else }}{{ required "external.postgresHost is required when postgres.enabled=false" .Values.external.postgresHost }}{{ end }}
{{- end }}

{{- define "pixelwar.rabbitmqHost" -}}
{{ if .Values.rabbitmq.enabled }}{{ .Release.Name }}-rabbitmq{{ else }}{{ required "external.rabbitmqHost is required when rabbitmq.enabled=false" .Values.external.rabbitmqHost }}{{ end }}
{{- end }}
