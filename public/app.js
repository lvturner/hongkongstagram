$(document).ready(function() {
  var socket = io.connect();
  
  socket.on("image", addImage); 

  socket.on("recent", function(data) {
    data.reverse().forEach(addImage);
  });

	socket.on("tags", function(data) {
		var maxCount = data[0].size;
		var fill = d3.scale.category20();
		var tags = document.getElementById("tags");
		var width = tags.offsetWidth;
		var height = tags.offsetHeight - 80; // bit of a hack

		var layout = d3.layout.cloud() 
				.size([width, height])
				.words(data.map(function(d) {
					d.size = 10 + (d.size / maxCount) * 100;
					return d;
				}))
				.padding(1)
				.rotate(function() { return ~~(Math.random() * 2) * 90; })
				.font("Impact")
				.fontSize(function(d) { return d.size; })
				.on("end", draw);

		layout.start();

	function draw(words) {
		d3.select("#tags").append("svg")
				.attr("width", layout.size()[0])
				.attr("height", layout.size()[1])
			.append("g")
				.attr("transform", "translate(" + layout.size()[0] / 2 + "," + layout.size()[1] / 2 + ")")
			.selectAll("text")
				.data(words)
			.enter().append("text")
				.style("font-size", function(d) { return d.size + "px"; })
				.style("font-family", "Impact")
				.style("fill", function(d, i) { return fill(i); })
				.attr("text-anchor", "middle")
				.attr("transform", function(d) {
					return "translate(" + [d.x, d.y] + ")rotate(" + d.rotate + ")";
				})
				.text(function(d) { return d.text; });
	}
	});

		
  var template = Handlebars.compile($("#image-template").html());

  $("#toggle").click(function(e) {
    $("#toggle .button").removeClass("selected");
    $(e.target).addClass("selected");
    
    if (e.target.id == "grid-button") {
			$("#tags").hide(); 
			$("#images").show();
		} else {
			console.log("Showing tags!");
		  $("#tags").show();
			$("#images").hide();
			socket.emit("tags", 1000);
		}
  });
	
  function addImage(image) {
		var captionText = image.caption.text.toLowerCase();
		if(captionText.indexOf(">>>") === -1) { // Spammers seem to nearly always use this chevron pattern
			image.date = moment.unix(image.created_time).format("MMM DD, h:mm a");
			var width = image.images.low_resolution.width;
			var height = image.images.low_resolution.height;
			var imgSrc = image.images.low_resolution.url;
			var img = new Image(width, height);
			img.crossOrigin = "Anonymous";
			img.addEventListener("load", function(e) {
				e.target.removeEventListener(e.type, arguments.callee);
				nude.load(img);
				nude.scan(function(result) {
					if(!result) {
						$("#images").append(template(image));
					} 
					img.remove();
				});
			}, false);
			img.src = imgSrc;
		} else {
			// nothing
		}

		// TODO: Tag cloud
  }

});
