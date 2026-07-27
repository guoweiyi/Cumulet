"use client";

import SwaggerUI from "swagger-ui-react";

export default function SwaggerDocs({ spec }: { spec: Record<string, unknown> }) {
  return (
    <SwaggerUI
      spec={spec}
      deepLinking
      displayRequestDuration
      docExpansion="list"
      persistAuthorization={false}
      tryItOutEnabled={false}
    />
  );
}
