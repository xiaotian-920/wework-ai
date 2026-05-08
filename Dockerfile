FROM nginx:alpine

COPY landing.html /usr/share/nginx/html/index.html

EXPOSE 80
